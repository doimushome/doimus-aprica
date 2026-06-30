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

function slugify(desc) {
  return (
    WASTE_TYPE_SLUGS[desc] ||
    desc
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
  );
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

    const pollIntervalMs = (config.pollInterval || 360) * 60 * 1000;

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

        // Group by waste desc, keeping the earliest *future* date per type.
        const byType = new Map();

        for (const item of items) {
          const desc = item.desc;
          const date = item.date; // epoch ms

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

          // Prefer the earliest future date.  If the stored date is
          // already in the past, any future date wins.
          if (date >= now && (current.date < now || date < current.date)) {
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

          const daysUntil = Math.max(
            0,
            Math.ceil((info.date - now) / (1000 * 60 * 60 * 24)),
          );

          const state = {
            next_collection: info.date,
            days_until: daysUntil,
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

    timer = setInterval(() => {
      fetchAndUpdate().catch((e) =>
        log("error", `Periodic Aprica fetch failed: ${e.message}`),
      );
    }, pollIntervalMs);
    if (timer.unref) timer.unref();
  },

  stop() {
    if (timer) clearInterval(timer);
    timer = null;
    registeredDeviceIds = [];
  },

  setConfig(cfg) {
    this.stop();
    this.start(cfg, savedApi);
  },
};
