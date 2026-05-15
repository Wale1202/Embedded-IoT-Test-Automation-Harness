// Shared test database helpers. Keeping these in one place is itself a
// test-engineering practice: every test starts from a known clean state.
const db = require('../../src/db/pool');

// Wipe all data (not schema) so each test is independent and order
// doesn't matter. RESTART IDENTITY resets serial IDs for predictable
// assertions; CASCADE handles the telemetry -> devices FK.
async function resetDatabase() {
  await db.query(
    'TRUNCATE telemetry, device_events, devices RESTART IDENTITY CASCADE'
  );
}

// Convenience: insert a registered device directly (a precondition for
// many telemetry tests) without going through the HTTP layer.
async function seedDevice(deviceId, name = 'Test Device', fw = '1.0.0') {
  await db.query(
    `INSERT INTO devices (device_id, device_name, firmware_version, status)
     VALUES ($1, $2, $3, 'offline')`,
    [deviceId, name, fw]
  );
}

// Read events for a device (used to verify the audit trail).
async function getEvents(deviceId) {
  const r = await db.query(
    `SELECT event_type, severity, description
     FROM device_events WHERE device_id = $1
     ORDER BY event_id`,
    [deviceId]
  );
  return r.rows;
}

async function closePool() {
  await db.pool.end();
}

module.exports = { resetDatabase, seedDevice, getEvents, closePool };
