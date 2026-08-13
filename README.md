# doimus-aprica

Aprica waste collection calendar — countdown sensors for each waste type (organico, plastica, vetro/metallo, indifferenziato, carta/cartone).

## Setup

1. Visit [Aprica Spa — Raccolta Differenziata](https://www.apricaspa.it/it/bergamo/servizi/raccolta-differenziata) and enter your address.
2. Open browser DevTools → Network tab, submit the form, and find the `calendar-items` request.
3. Copy the `geociv` value from the request payload (e.g. `574314533`).
4. Install via hub and paste the geociv in the plugin settings.

## Config

| Field | Type | Default | Description |
|---|---|---|---|
| `geociv` | integer | — | Your address geo-civic ID (required) |
| `pollInterval` | int | 60 | Poll interval in minutes. The plugin also refreshes right after local midnight (in `timezone`) so "today" advances promptly |
| `timezone` | string | `Europe/Rome` | IANA timezone of your collection area. Aprica dates are midnight local, so this keeps `days_until` (today/tomorrow) correct |

## Devices

Registers one sensor per waste type. Device name is `Rifiuti — <desc>`; the short type label is exposed via the `collection_type` state key so clients don't need to parse the name.

| Sensor | Capabilities |
|---|---|
| `Rifiuti — Raccolta organico` | `next_collection` (epoch ms), `days_until` (int, 0=today 1=tomorrow), `collection_timezone` (IANA), `collection_type` (short label), `collection_note` (string), `collection_color` (hex), `collection_icon` (URL) |
| `Rifiuti — Raccolta plastica` | same as above |
| `Rifiuti — Raccolta vetro e metallo` | same as above |
| `Rifiuti — Raccolta indifferenziato` | same as above |
| `Rifiuti — Raccolta carta e cartone` | same as above |

## State-key convention

Any waste-collection plugin can adopt these state keys to get the rich card in the mobile app (colored tile when a collection is today/tomorrow, short type label, relative day):

- `next_collection` — epoch ms of the next collection
- `days_until` — calendar-day difference: `0` = today, `1` = tomorrow, `N` = in N days
- `collection_timezone` — IANA timezone used for the calendar-day math (the mobile app recomputes the relative day from `next_collection` at render time so it never goes stale between polls)
- `collection_type` — short human label of the waste type (e.g. "Organico")
- `collection_note` — instruction/note string (e.g. "Esporre entro le 12:30")
- `collection_color` — hex color (e.g. `#46ae4b`); the tile is tinted with it when `days_until <= 1`
- `collection_icon` — icon URL

`days_until` must be computed as a **calendar-day** difference in the collection area's timezone (not a raw epoch delta), otherwise today's collection gets mislabelled as "in the past" once the local day starts. The mobile app derives the label from `next_collection` + `collection_timezone` itself, so a stale `days_until` snapshot never shows a wrong "today" after midnight.

## Data Source

[Aprica Spa](https://www.apricaspa.it/) — waste collection calendar API for Bergamo and surrounding municipalities.
