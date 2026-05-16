# Embedded/IoT Test Automation Harness — MVP Backend

[![CI](https://github.com/Wale1202/Embedded-IoT-Test-Automation-Harness/actions/workflows/ci.yml/badge.svg)](https://github.com/Wale1202/Embedded-IoT-Test-Automation-Harness/actions/workflows/ci.yml)

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

Deliberately flat. A request flows: **route → validation → database →
event log**. There is no controller/service indirection — each route
reads top to bottom, which is what makes the failure handling easy to
walk through.

```
src/
├── app.js            Express app: wires routes + JSON-parse handling
├── server.js         Entrypoint (app.listen) — split out so tests
│                      can run the app in-process with Supertest
├── config.js         Env config + anomaly thresholds (one place)
├── validation.js     Hard validation (reject) + soft anomalies (flag)
├── events.js         Device-event log: recordEvent / listEvents
├── asyncHandler.js   One-line async error forwarding
├── errorHandler.js   404 + central error responder
├── db/
│   ├── pool.js       Shared PostgreSQL pool
│   ├── migrate.js    Migration runner (npm run migrate)
│   └── migrations/   001_init.sql, 002_device_events.sql
└── routes/
    ├── telemetry.js  ★ ingest + all 7 failure scenarios (the core)
    ├── devices.js    register, status, history, events, offline-sweep
    ├── events.js     global event log
    └── health.js     liveness + DB check
```

Two files do the heavy lifting and are the ones to read first:
[`routes/telemetry.js`](src/routes/telemetry.js) (the ingest pipeline,
one labelled block per failure scenario) and
[`validation.js`](src/validation.js) (every rule, as small pure
functions that are trivial to unit-test).

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
| `GET`  | `/api/v1/devices/:deviceId/events?severity=&type=&limit=N` | Event log for one device |
| `POST` | `/api/v1/devices/offline-sweep` | Mark silent devices offline (logs `DEVICE_OFFLINE`) |
| `POST` | `/api/v1/telemetry` | Receive a telemetry frame |
| `GET`  | `/api/v1/events?severity=&type=&limit=N` | Global event log |

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

## Failure scenarios

Every detected failure is given a clear HTTP response **and** written to
the `device_events` log (`event_type`, `severity`, `device_id`,
`description`, `created_at`). Inspect them via the `/events` endpoints.

| # | Scenario | Detection & response | Event logged |
|---|----------|----------------------|--------------|
| 1 | Malformed telemetry (bad JSON) | `400` "Request body is not valid JSON" | `MALFORMED_TELEMETRY` (warning) |
| 2 | Duplicate telemetry | `409` if `(device_id, client timestamp)` already stored | `DUPLICATE_TELEMETRY` (warning) |
| 3 | Device goes offline | `offline-sweep` marks silent devices offline | `DEVICE_OFFLINE` (warning) |
| 4 | Extreme sensor values | `400`, rejected (out of physical range) | `EXTREME_VALUE` (critical) |
| 5 | Missing / wrong-type fields | `400`, all problems listed | `MISSING_FIELDS` (warning) |
| 6 | Stale / future timestamp | **accepted**, flagged (stale > 300s, or > 60s ahead) | `STALE_TIMESTAMP` (warning) |
| 7 | Telemetry before registration | `404`, frame rejected | `UNREGISTERED_DEVICE` (error) |

Plus **soft anomalies** — telemetry is accepted and stored, but a
warning event is logged and echoed in the response `warnings[]`:
`LOW_BATTERY`, `WEAK_SIGNAL`, `HIGH_TEMPERATURE` (thresholds in `.env`).

Design rule: **invalid data is rejected; degraded-but-valid data is
stored and flagged.** A real fleet must see a dying battery, not drop it.

## Design choices (interview notes)

- **Reject vs. flag.** Hard validation failures (missing/garbage/extreme)
  get a `4xx` and are *not* stored. Soft anomalies (low battery, weak
  signal, stale clock) are *stored* and logged as warnings — losing a
  degraded reading is worse than keeping it.
- **Every failure is observable.** A clear HTTP response is for the
  device; the `device_events` row is for the engineer. The `/events`
  endpoints are the audit trail you'd inspect after a test run.
- **Logging never breaks ingest.** `recordEvent` swallows its own
  errors, and success-path anomaly events are written *after* the
  telemetry commit — a logging hiccup can't lose a reading.
- **Atomic ingest.** The unregistered-device check, duplicate check,
  device update, and telemetry insert run in one transaction, so a
  rejected frame leaves no partial state.
- **Flat structure on purpose.** No controller/service layers — for a
  project this size they would add indirection without value. The
  trade-off (logic lives in the route) is acceptable here and would be
  the first thing to revisit if the surface grew.

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
curl "localhost:3000/api/v1/devices/SAT-NODE-001/history?limit=10"  # quotes: zsh treats ? as a glob

# Mark devices offline if silent past OFFLINE_THRESHOLD_SECONDS
curl -X POST localhost:3000/api/v1/devices/offline-sweep

# Inspect the failure/anomaly event log
curl "localhost:3000/api/v1/devices/SAT-NODE-001/events?limit=20"
curl "localhost:3000/api/v1/events?severity=critical"
```

## Behaviour notes

- A device is `offline` at registration and flips to `online` on its
  first telemetry frame (which also sets `last_seen`).
- `offline-sweep` is the liveness check a scheduled monitoring job would
  run; it marks any device silent beyond the threshold as `offline`.
- Telemetry for an unregistered device is rejected (`404`) rather than
  stored as an orphan reading — protecting referential integrity.

## Device simulator

A single dependency-free script ([simulator/device.js](simulator/device.js))
that pretends to be an embedded device: it registers itself, then sends
a telemetry frame every few seconds according to a chosen mode. This is
how you exercise the failure handling without real hardware.

```bash
npm start                                  # backend in one terminal
node simulator/device.js normal            # in another
node simulator/device.js invalid SIM-9 2   # mode, device id, interval(s)
```

Positional args: `<mode>` (default `normal`), `[deviceId]` (`SIM-001`),
`[intervalSeconds]` (`3`). Backend URL is the `BASE_URL` constant at the
top of the file.

| Mode | Behaviour | Expected backend response |
|------|-----------|---------------------------|
| `normal` | nominal readings | `201` accepted |
| `invalid` | out-of-range values | `400` rejected (`EXTREME_VALUE`) |
| `offline` | registers, then stays silent | run `offline-sweep` → `DEVICE_OFFLINE` |
| `duplicate` | resends one frame (same timestamp) | first `201`, then `409` |
| `low-battery` | valid but battery 1–10 % | `201` + `LOW_BATTERY` warning |
| `weak-signal` | valid but signal ≤ -101 dBm | `201` + `WEAK_SIGNAL` warning |
| `random` | random behaviour each tick | mixed |

Each tick prints the mode, HTTP status, and the backend's JSON response,
so you can watch the harness detect and log every scenario live.

## Testing

Jest + Supertest, run against a real PostgreSQL instance (API
integration level — that's where validation, transactions, and the
event log actually interact).

```bash
docker compose up -d   # PostgreSQL must be reachable
npm test               # jest --runInBand  (20 tests, 3 suites)
```

- **Isolation:** every test starts from a truncated database
  ([test/setup.js](test/setup.js)), so cases are order-independent.
- **Traceability:** each test name carries a `TC-xx` ID that maps to
  [TEST_PLAN.md](TEST_PLAN.md) — the plan and the suite stay in sync.
- **Why `--runInBand`:** the suite shares one database; serial
  execution avoids cross-test races.

See [TEST_PLAN.md](TEST_PLAN.md) for the full case list (preconditions,
steps, expected results) and the latest run log.

## Continuous integration

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on **every
push and pull request**: it installs dependencies with `npm ci`, spins
up a PostgreSQL service container, runs the full Jest suite, and
**fails the build if any test fails**. The badge at the top reflects the
latest run on the default branch.

This is a small model of how automated regression testing is integrated
into a CI/CD pipeline for **embedded or high-reliability systems**:

- **No change is trusted until it is re-verified.** Every push re-runs
  the entire device-to-backend test plan automatically — the same
  principle behind regression gates in avionics, space, and medical
  software, where a human "I tested it locally" is not acceptable
  evidence.
- **The pipeline tests against a real database**, not mocks, so the
  integration risk (validation + transactions + the failure-event log)
  is exercised exactly as in production — closer to hardware-in-the-loop
  thinking than a unit-test-only gate.
- **A red check blocks the change.** In a real embedded programme this
  is where the build would also block promotion to flashing firmware or
  deploying the ground segment; here it blocks the merge. Same gate,
  smaller stakes.
- **Reproducibility is enforced**, not hoped for: `npm ci` installs
  from the lockfile and the database is recreated clean each run, so a
  pass means the same thing on every machine — a prerequisite for any
  test evidence that has to be auditable.

The result: the test plan in [TEST_PLAN.md](TEST_PLAN.md) stops being a
document someone *might* run and becomes an automatically enforced
contract — which is the entire point of CI for safety-relevant code.

## Next iterations (not in this MVP)

Device simulator with fault-injection, sequence-gap detection, CI/CD via
GitHub Actions running this suite on every push.
