"use strict";

const axios = require("axios");

const API_URL =
  "https://www.apricaspa.it/api/service/area-services/calendar-items";

let timer = null;
let savedApi = null;
let registeredDeviceIds = [];
let log = null;

function createLogger(api, prefix) {
  return (level, msg) => api.log(level, `[${prefix}] ${msg}`);
}

// Map Italian waste descriptions to stable slugs for device IDs.
// Any unknown desc is slugified at runtime.
const WASTE_TYPE_SLUGS = {
  "Raccolta organico": "organico",
  "Raccolta plastica": "plastica",
  "Raccolta vetro e metallo": "vetro-metallo",
  "Raccolta indifferenziato": "indifferenziato",
  "Raccolta carta e cartone": "carta-cartone",
};

// Short human labels used for the `collection_type` state key, so the mobile
// app can show the waste type without parsing the device name.
const WASTE_TYPE_LABELS = {
  "Raccolta organico": "Organico",
  "Raccolta plastica": "Plastica",
  "Raccolta vetro e metallo": "Vetro e metallo",
  "Raccolta indifferenziato": "Indifferenziato",
  "Raccolta carta e cartone": "Carta e cartone",
};

function slugify(desc) {
  return (
    WASTE_TYPE_SLUGS[desc] ||
    desc
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
  );
}

function typeLabel(desc) {
  return WASTE_TYPE_LABELS[desc] || desc;
}

const DAY_MS = 1000 * 60 * 60 * 24;

// Calendar day (YYYY-MM-DD) of a timestamp in the given timezone. Collection
// dates from the API are at midnight local time, so raw epoch comparison
// against a UTC clock mislabels today's collection as already past. Comparing
// calendar days in the user's timezone keeps "today" correct all day.
function dayKey(ts, tz) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ts));
}

function daysBetween(fromMs, toMs, tz) {
  const from = Date.parse(dayKey(fromMs, tz));
  const to = Date.parse(dayKey(toMs, tz));
  return Math.round((to - from) / DAY_MS);
}

// UTC offset (ms) of `tz` at the given instant, derived from Intl formatting.
function tzOffsetMs(tz, epochMs) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(epochMs));
  const v = {};
  for (const p of parts) v[p.type] = Number(p.value);
  const asUtc = Date.UTC(
    v.year,
    v.month - 1,
    v.day,
    v.hour,
    v.minute,
    v.second,
  );
  return asUtc - epochMs;
}

// Epoch ms for a local wall-clock time (1-based month/day) in `tz`. Iterates a
// few times so the timezone offset at the target time converges (DST-correct).
function wallClockEpoch(tz, year, month, day, hour, minute, second) {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = naive;
  for (let i = 0; i < 3; i++) {
    guess = naive - tzOffsetMs(tz, guess);
  }
  return guess;
}

// Real ms from now until the next HH:MM local time in `tz`.
function msUntilLocalTime(tz, hh, mm) {
  const nowMs = Date.now();
  const [y, m, d] = dayKey(nowMs, tz).split("-").map(Number);
  let target = wallClockEpoch(tz, y, m, d, hh, mm, 0);
  if (target <= nowMs) {
    // Already past today: advance one calendar day in `tz`.
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    target = wallClockEpoch(
      tz,
      next.getUTCFullYear(),
      next.getUTCMonth() + 1,
      next.getUTCDate(),
      hh,
      mm,
      0,
    );
  }
  return target - nowMs;
}

module.exports = {
  start(config, api) {
    savedApi = api;
    log = createLogger(api, "Aprica");
    const geociv = config.geociv;
    if (!geociv) {
      log("error", "geociv is required. Set it in plugin settings.");
      return;
    }

    // Timezone of the collection area. Aprica timestamps are midnight local.
    const tz = config.timezone || "Europe/Rome";
    const pollIntervalMs = (config.pollInterval || 60) * 60 * 1000;

    async function fetchAndUpdate() {
      try {
        const response = await axios.post(API_URL, {
          geociv: Number(geociv),
        });

        if (
          !response.data ||
          response.data.status !== 1 ||
          !Array.isArray(response.data.data)
        ) {
          log("error", "Unexpected API response from Aprica");
          return;
        }

        const items = response.data.data;
        const now = Date.now();
        const todayKey = dayKey(now, tz);

        // Group by waste desc, keeping the earliest collection whose calendar
        // day is today or later.
        const byType = new Map();

        for (const item of items) {
          const desc = item.desc;
          const date = item.date; // epoch ms

          if (dayKey(date, tz) < todayKey) continue;

          if (!byType.has(desc)) {
            byType.set(desc, {
              desc,
              date,
              rgb: item.rgb,
              icon: item.icon,
              note: item.note,
            });
            continue;
          }

          const current = byType.get(desc);
          if (date < current.date) {
            current.date = date;
            current.rgb = item.rgb;
            current.icon = item.icon;
            current.note = item.note;
          }
        }

        const seenIds = new Set();

        for (const [desc, info] of byType) {
          const slug = slugify(desc);
          const deviceId = `aprica-${geociv}-${slug}`;
          seenIds.add(deviceId);

          const daysUntil = daysBetween(now, info.date, tz);

          const state = {
            next_collection: info.date,
            days_until: daysUntil,
            collection_timezone: tz,
            collection_type: typeLabel(desc),
            collection_note: info.note || "",
            collection_color: info.rgb || "",
            collection_icon: info.icon || "",
          };

          if (!registeredDeviceIds.includes(deviceId)) {
            api.registerDevice({
              id: deviceId,
              name: `Rifiuti — ${desc}`,
              type: "sensor",
              capabilities: Object.keys(state),
              state,
            });
            registeredDeviceIds.push(deviceId);
            log("info", `Registered Aprica sensor: ${deviceId} (${desc})`);
          } else {
            api.updateDeviceState(deviceId, state);
          }
        }

        // Remove any stale devices that are no longer in the data
        registeredDeviceIds = registeredDeviceIds.filter((id) =>
          seenIds.has(id),
        );

        log(
          "debug",
          `Aprica updated for geociv=${geociv} (${byType.size} waste types)`,
        );
      } catch (err) {
        log("error", `Aprica fetch failed: ${err.message}`);
      }
    }

    fetchAndUpdate().catch((e) =>
      log("error", `Initial Aprica fetch failed: ${e.message}`),
    );

    // Self-rescheduling poll: fire at least every pollInterval, but also right
    // after the next local midnight in the collection timezone so "today"
    // advances as soon as the calendar day rolls over (midnight + 10 min).
    function scheduleNext() {
      const delay = Math.min(pollIntervalMs, msUntilLocalTime(tz, 0, 10));
      timer = setTimeout(() => {
        fetchAndUpdate().catch((e) =>
          log("error", `Periodic Aprica fetch failed: ${e.message}`),
        );
        scheduleNext();
      }, delay);
      if (timer.unref) timer.unref();
    }

    scheduleNext();
  },

  stop() {
    if (timer) clearTimeout(timer);
    timer = null;
    registeredDeviceIds = [];
  },

  setConfig(cfg) {
    this.stop();
    this.start(cfg, savedApi);
  },
};
