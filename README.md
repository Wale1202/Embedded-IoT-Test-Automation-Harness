# Embedded/IoT Test Automation Harness — MVP Backend

Simulates IoT/embedded devices reporting telemetry to a ground backend,
with strict input validation and a device-liveness sweep. Built to
demonstrate device-to-backend communication, data integrity, and
verification — the core concerns of an embedded test engineer.

## Tech stack

- Node.js + Express
- PostgreSQL (`pg`)
- Plain JS, dependency-light, structured for testability

## Architecture

```
Device  ──POST telemetry──▶  Express API  ──▶  PostgreSQL
                              (validate →        devices
                               persist →         telemetry
                               update last_seen)
                                   ▲
                  offline-sweep ───┘  (marks silent devices offline)
```

`src/app.js` builds the app; `src/server.js` starts it. The split lets a
later test suite drive the API in-process with Supertest.

## Project structure

```
src/
├── app.js                 Express app (routes + middleware wiring)
├── server.js              Process entrypoint (app.listen)
├── config.js              Env-driven configuration
├── db/
│   ├── pool.js            Shared PostgreSQL pool
│   ├── migrate.js         Migration runner (npm run migrate)
│   └── migrations/001_init.sql
├── domain/validation.js   Registration + telemetry validators
├── middleware/errorHandler.js
├── routes/
│   ├── devices.js         Register, status, history, offline-sweep
│   ├── telemetry.js       Telemetry ingest
│   └── health.js          Liveness + DB check
└── utils/logger.js
```

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Start PostgreSQL** (Docker is easiest):

   ```bash
   docker compose up -d
   ```

3. **Configure environment**

   ```bash
   cp .env.example .env
   # defaults match docker-compose.yml; edit if needed
   ```

4. **Create the schema**

   ```bash
   npm run migrate
   ```

5. **Run the server**

   ```bash
   npm start      # or: npm run dev  (auto-restart on change)
   ```

   The API is now on `http://localhost:3000`.

## API

Base path: `/api/v1`. All requests/responses are JSON.

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/health` | Liveness + DB connectivity |
| `POST` | `/api/v1/devices` | Register a device |
| `GET`  | `/api/v1/devices/:deviceId/status` | Latest device status |
| `GET`  | `/api/v1/devices/:deviceId/history?limit=N` | Telemetry history (newest first) |
| `POST` | `/api/v1/devices/offline-sweep` | Mark silent devices offline |
| `POST` | `/api/v1/telemetry` | Receive a telemetry frame |

### Validation rules

| Field | Rule | On failure |
|-------|------|-----------|
| `device_id` | required, non-empty string | `400`, clear message |
| `temperature` | finite number, **-55 to 150 °C** | `400` |
| `battery_level` | finite number, **0 to 100 %** | `400` |
| `signal_strength` | finite number, **-120 to 0 dBm** (RSSI) | `400` |

Validation reports **all** problems in one response so a misbehaving
device can be diagnosed in a single round trip:

```json
{ "error": "Validation failed",
  "details": ["temperature 999 is out of range [-55, 150] °C",
              "battery_level 140 is out of range [0, 100] %"] }
```

Other notable responses: `409` (device already registered),
`404` (telemetry/status/history for an unregistered device),
`503` (`/health` when the DB is unreachable).

## Example session

```bash
# Register a device
curl -X POST localhost:3000/api/v1/devices \
  -H 'Content-Type: application/json' \
  -d '{"device_id":"SAT-NODE-001","device_name":"Edge Sensor 1","firmware_version":"1.2.0"}'

# Send a telemetry frame
curl -X POST localhost:3000/api/v1/telemetry \
  -H 'Content-Type: application/json' \
  -d '{"device_id":"SAT-NODE-001","temperature":21.4,"signal_strength":-78,"battery_level":87}'

# Rejected: out-of-range values
curl -X POST localhost:3000/api/v1/telemetry \
  -H 'Content-Type: application/json' \
  -d '{"device_id":"SAT-NODE-001","temperature":999,"signal_strength":50,"battery_level":140}'

# Check status / history
curl localhost:3000/api/v1/devices/SAT-NODE-001/status
curl localhost:3000/api/v1/devices/SAT-NODE-001/history?limit=10

# Mark devices offline if silent past OFFLINE_THRESHOLD_SECONDS
curl -X POST localhost:3000/api/v1/devices/offline-sweep
```

## Behaviour notes

- A device is `offline` at registration and flips to `online` on its
  first telemetry frame (which also sets `last_seen`).
- `offline-sweep` is the liveness check a scheduled monitoring job would
  run; it marks any device silent beyond the threshold as `offline`.
- Telemetry for an unregistered device is rejected (`404`) rather than
  stored as an orphan reading — protecting referential integrity.

## Next iterations (not in this MVP)

Automated test suite (Jest + Supertest), device simulator with
fault-injection, sequence-gap detection, CI/CD via GitHub Actions.
