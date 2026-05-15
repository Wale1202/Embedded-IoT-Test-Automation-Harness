# Test Plan — Embedded/IoT Test Automation Harness

## 1. Purpose

Verify that the telemetry backend correctly handles device registration,
telemetry ingest, input validation, and the defined failure scenarios —
and that every detected failure is recorded in the device-event audit
trail.

## 2. Scope

In scope: REST API behaviour, validation rules, the 7 failure
scenarios, and event logging. Out of scope: load/performance, security,
the (future) device simulator and CI pipeline.

## 3. Test approach

- **Level:** API integration tests (Express app driven in-process with
  Supertest) against a real PostgreSQL instance — this exercises
  validation, transactions, and the event log together, which is where
  the risk actually lives.
- **Isolation:** every test starts from a truncated database
  (`test/setup.js`), so tests are order-independent and repeatable.
- **Traceability:** every automated test name is prefixed with its Test
  Case ID below, so the plan and the code map 1:1.
- **Tooling:** Jest + Supertest. Run with `npm test`
  (`jest --runInBand` — serial, because the suite shares one database).

## 4. Environment & preconditions (all cases)

- Node.js ≥ 18, dependencies installed (`npm install`).
- PostgreSQL reachable (`docker compose up -d`); schema applied
  automatically by the test global setup.
- Unless stated otherwise, the database is empty at the start of a case.

## 5. Test cases

> **Actual result** / **Status** are placeholders for a manual execution
> record. The automated run log (section 6) is the source of truth for
> the current build.

---

### TC-01 — Successful device registration
- **Description:** A new device can be registered.
- **Preconditions:** Device `DEV-1` does not exist.
- **Steps:**
  1. `POST /api/v1/devices` with `device_id`, `device_name`,
     `firmware_version`.
- **Expected result:** `201`; body echoes the device with
  `status: "offline"` and `last_seen: null`.
- **Actual result:** _______________________
- **Status:** ☐ Pass ☐ Fail

### TC-02 — Successful telemetry submission
- **Description:** A valid telemetry frame is stored and the device is
  marked online.
- **Preconditions:** Device `DEV-1` is registered.
- **Steps:**
  1. `POST /api/v1/telemetry` with a valid frame.
  2. `GET /api/v1/devices/DEV-1/status`.
- **Expected result:** `201` with a `telemetry_id` and empty
  `warnings`; status becomes `online`.
- **Actual result:** _______________________
- **Status:** ☐ Pass ☐ Fail

### TC-03 — Rejection of missing device_id
- **Description:** Telemetry without `device_id` is rejected.
- **Preconditions:** None.
- **Steps:**
  1. `POST /api/v1/telemetry` with `device_id` omitted.
- **Expected result:** `400`, `error: "Validation failed"`, details
  state `device_id is required`.
- **Actual result:** _______________________
- **Status:** ☐ Pass ☐ Fail

### TC-04 — Rejection of invalid battery_level
- **Description:** `battery_level` outside 0–100 is rejected.
- **Preconditions:** Device `DEV-1` is registered.
- **Steps:**
  1. `POST /api/v1/telemetry` with `battery_level: 140`.
- **Expected result:** `400`; details state `battery_level 140 is out
  of range`.
- **Actual result:** _______________________
- **Status:** ☐ Pass ☐ Fail

### TC-05 — Rejection of invalid temperature
- **Description:** Temperature out of range, and non-numeric
  temperature, are both rejected.
- **Preconditions:** Device `DEV-1` is registered.
- **Steps:**
  1. `POST /api/v1/telemetry` with `temperature: 999`.
  2. `POST /api/v1/telemetry` with `temperature: "hot"`.
- **Expected result:** `400` for both; details state out-of-range and
  "must be a finite number" respectively.
- **Actual result:** _______________________
- **Status:** ☐ Pass ☐ Fail

### TC-06 — Rejection of unregistered-device telemetry
- **Description:** Telemetry from an unknown device is rejected (no
  orphan readings).
- **Preconditions:** Device `GHOST` is **not** registered.
- **Steps:**
  1. `POST /api/v1/telemetry` with `device_id: "GHOST"`.
- **Expected result:** `404`; error states the device is not
  registered.
- **Actual result:** _______________________
- **Status:** ☐ Pass ☐ Fail

### TC-07 — Duplicate telemetry detection
- **Description:** The same `(device_id, timestamp)` frame sent twice is
  detected.
- **Preconditions:** Device `DEV-1` is registered.
- **Steps:**
  1. `POST /api/v1/telemetry` with an explicit `timestamp` → expect
     `201`.
  2. `POST` the identical frame again.
- **Expected result:** Second request `409`; error mentions
  "duplicate".
- **Actual result:** _______________________
- **Status:** ☐ Pass ☐ Fail

### TC-08 — Offline device detection
- **Description:** The sweep marks a previously-online device offline
  once it has been silent past the threshold, and leaves a recently
  active device alone.
- **Preconditions:** `IDLE-1` registered and reported with a stale
  timestamp; `LIVE-1` registered and reporting now.
- **Steps:**
  1. `POST /api/v1/devices/offline-sweep`.
  2. `GET` status for both devices.
- **Expected result:** `IDLE-1` in `device_ids`, status `offline`,
  `DEVICE_OFFLINE` event logged; `LIVE-1` not swept, stays `online`.
- **Actual result:** _______________________
- **Status:** ☐ Pass ☐ Fail

### TC-09 — Event logging when bad telemetry is received
- **Description:** Each failure type writes the correct event
  (`event_type` + `severity`) to the audit trail; a soft anomaly (low
  battery) is accepted but still flagged.
- **Preconditions:** Per sub-case (device registered or not).
- **Steps:** Trigger missing-fields, extreme-value, unregistered, and
  duplicate cases; then submit a low-battery frame; read
  `device_events`.
- **Expected result:** `MISSING_FIELDS` (warning), `EXTREME_VALUE`
  (critical), `UNREGISTERED_DEVICE` (error), `DUPLICATE_TELEMETRY`
  (warning) logged; low-battery frame `201` with `LOW_BATTERY` in
  `warnings` and the event log.
- **Actual result:** _______________________
- **Status:** ☐ Pass ☐ Fail

### TC-10 — Get device status and event history
- **Description:** Status, telemetry history (newest-first), and the
  filtered event log are retrievable.
- **Preconditions:** Device `DEV-1` registered with ≥2 telemetry frames;
  one critical event present.
- **Steps:**
  1. `GET /api/v1/devices/DEV-1/status`.
  2. `GET /api/v1/devices/DEV-1/history?limit=10`.
  3. `GET /api/v1/events?severity=critical`.
  4. `GET /api/v1/devices/NOPE/status` (negative).
- **Expected result:** Correct status; history `count: 2`, newest
  first; critical filter returns only critical events; unknown device
  `404`.
- **Actual result:** _______________________
- **Status:** ☐ Pass ☐ Fail

### TC-11 — Duplicate registration rejected (additional coverage)
- **Description:** Re-registering an existing `device_id` is rejected.
- **Preconditions:** `DEV-1` already registered.
- **Steps:** `POST /api/v1/devices` again with the same id.
- **Expected result:** `409`; error mentions "already registered".
- **Actual result:** _______________________
- **Status:** ☐ Pass ☐ Fail

### TC-12 — Malformed JSON body rejected (additional coverage)
- **Description:** A body that is not valid JSON is rejected cleanly
  (failure scenario 1).
- **Preconditions:** None.
- **Steps:** `POST /api/v1/telemetry` with body `{ this is not json`.
- **Expected result:** `400`; error states the body is not valid JSON;
  no stack trace leaked.
- **Actual result:** _______________________
- **Status:** ☐ Pass ☐ Fail

---

## 6. Automated run log

| Date | Build | Command | Result |
|------|-------|---------|--------|
| 2026-05-15 | MVP + failure scenarios | `npm test` | **20/20 passed** (3 suites) |

Test file → case mapping:

| File | Cases |
|------|-------|
| `test/devices.test.js` | TC-01, TC-08, TC-10, TC-11 |
| `test/telemetry.test.js` | TC-02, TC-03, TC-04, TC-05, TC-06, TC-07, TC-12 |
| `test/events.test.js` | TC-09, TC-10 (event-log retrieval) |

## 7. Notes & known limitations

- Duplicate detection (TC-07) applies only when the device supplies its
  own `timestamp`; a server-assigned timestamp is unique by design.
- Offline detection (TC-08) detects the *online → silent* transition; a
  device registered but never seen is already `offline` and is
  intentionally not re-flagged.
- The suite TRUNCATEs tables between tests — point it at a throwaway
  database via `TEST_DATABASE_URL`, not a database with real data.
