// Device event log.
//
// Every detected failure or anomaly is recorded here with: event_type,
// severity, device_id, description, created_at. This audit trail is the
// heart of the project - it's what you'd inspect after a test run to
// see exactly which failures the backend caught.
const db = require('./db/pool');

const SEVERITY = {
  WARNING: 'warning',
  ERROR: 'error',
  CRITICAL: 'critical',
};

// One constant per failure scenario, so route code can't typo a type.
const EVENT_TYPES = {
  MALFORMED_TELEMETRY: 'MALFORMED_TELEMETRY', // 1: body isn't valid JSON
  DUPLICATE_TELEMETRY: 'DUPLICATE_TELEMETRY', // 2: frame already stored
  DEVICE_OFFLINE: 'DEVICE_OFFLINE', // 3: silent too long
  EXTREME_VALUE: 'EXTREME_VALUE', // 4: sensor value out of range
  MISSING_FIELDS: 'MISSING_FIELDS', // 5: required field absent
  STALE_TIMESTAMP: 'STALE_TIMESTAMP', // 6: old / future timestamp
  UNREGISTERED_DEVICE: 'UNREGISTERED_DEVICE', // 7: unknown device
  LOW_BATTERY: 'LOW_BATTERY', // soft anomaly
  WEAK_SIGNAL: 'WEAK_SIGNAL', // soft anomaly
  HIGH_TEMPERATURE: 'HIGH_TEMPERATURE', // soft anomaly
};

// Record one event. Errors are logged and swallowed: writing the audit
// trail must never break the request it is observing.
async function recordEvent({ deviceId = null, type, severity, description }) {
  try {
    const r = await db.query(
      `INSERT INTO device_events (device_id, event_type, severity, description)
       VALUES ($1, $2, $3, $4)
       RETURNING event_id, device_id, event_type, severity, description, created_at`,
      [deviceId, type, severity, description]
    );
    return r.rows[0];
  } catch (err) {
    console.error('[events] failed to record event:', err.message);
    return null;
  }
}

// Read events, optionally filtered by device, severity, or type.
async function listEvents({ deviceId, severity, type, limit = 50 }) {
  const clauses = [];
  const params = [];
  if (deviceId) {
    params.push(deviceId);
    clauses.push(`device_id = $${params.length}`);
  }
  if (severity) {
    params.push(severity);
    clauses.push(`severity = $${params.length}`);
  }
  if (type) {
    params.push(type);
    clauses.push(`event_type = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(limit);

  const r = await db.query(
    `SELECT event_id, device_id, event_type, severity, description, created_at
     FROM device_events
     ${where}
     ORDER BY created_at DESC, event_id DESC
     LIMIT $${params.length}`,
    params
  );
  return r.rows;
}

module.exports = { SEVERITY, EVENT_TYPES, recordEvent, listEvents };
