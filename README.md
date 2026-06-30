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
| `pollInterval` | int | 360 | Poll interval in minutes (default: 6 hours) |

## Devices

Registers one sensor per waste type:

| Sensor | Capabilities |
|---|---|
| `Rifiuti — Raccolta organico` | `next_collection` (epoch ms), `days_until` (int), `collection_note` (string), `collection_color` (hex), `collection_icon` (URL) |
| `Rifiuti — Raccolta plastica` | same as above |
| `Rifiuti — Raccolta vetro e metallo` | same as above |
| `Rifiuti — Raccolta indifferenziato` | same as above |
| `Rifiuti — Raccolta carta e cartone` | same as above |

## Data Source

[Aprica Spa](https://www.apricaspa.it/) — waste collection calendar API for Bergamo and surrounding municipalities.
