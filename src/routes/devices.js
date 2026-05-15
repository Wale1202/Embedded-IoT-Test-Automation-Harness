// Device lifecycle endpoints: register, status, history, offline-sweep.
const express = require('express');
const db = require('../db/pool');
const config = require('../config');
const { validateDeviceRegistration } = require('../domain/validation');

const router = express.Router();

// Wraps an async handler so rejected promises reach the error middleware.
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// POST /api/v1/devices  -- register a new device.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const errors = validateDeviceRegistration(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    const { device_id, device_name, firmware_version } = req.body;

    // ON CONFLICT DO NOTHING => second registration of the same id is
    // rejected with 409 rather than silently overwriting the device.
    const result = await db.query(
      `INSERT INTO devices (device_id, device_name, firmware_version, status)
       VALUES ($1, $2, $3, 'offline')
       ON CONFLICT (device_id) DO NOTHING
       RETURNING device_id, device_name, firmware_version, status, last_seen`,
      [device_id, device_name, firmware_version]
    );

    if (result.rowCount === 0) {
      return res
        .status(409)
        .json({ error: `Device '${device_id}' is already registered` });
    }
    return res.status(201).json(result.rows[0]);
  })
);

// GET /api/v1/devices/:deviceId/status  -- latest known device state.
router.get(
  '/:deviceId/status',
  asyncHandler(async (req, res) => {
    const { deviceId } = req.params;
    const result = await db.query(
      `SELECT device_id, device_name, firmware_version, status, last_seen
       FROM devices WHERE device_id = $1`,
      [deviceId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: `Device '${deviceId}' not found` });
    }
    return res.json(result.rows[0]);
  })
);

// GET /api/v1/devices/:deviceId/history  -- telemetry event history,
// newest first. Optional ?limit=N (default 50, capped at 500).
router.get(
  '/:deviceId/history',
  asyncHandler(async (req, res) => {
    const { deviceId } = req.params;

    const requested = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requested)
      ? Math.min(Math.max(requested, 1), 500)
      : 50;

    const device = await db.query(
      'SELECT 1 FROM devices WHERE device_id = $1',
      [deviceId]
    );
    if (device.rowCount === 0) {
      return res.status(404).json({ error: `Device '${deviceId}' not found` });
    }

    const result = await db.query(
      `SELECT telemetry_id, device_id, temperature, signal_strength,
              battery_level, timestamp
       FROM telemetry
       WHERE device_id = $1
       ORDER BY timestamp DESC
       LIMIT $2`,
      [deviceId, limit]
    );

    return res.json({ device_id: deviceId, count: result.rowCount, events: result.rows });
  })
);

// POST /api/v1/devices/offline-sweep  -- mark every device that has not
// reported within OFFLINE_THRESHOLD_SECONDS as "offline". This is the
// liveness check a monitoring job would run on a schedule.
router.post(
  '/offline-sweep',
  asyncHandler(async (req, res) => {
    const seconds = config.offlineThresholdSeconds;
    const result = await db.query(
      `UPDATE devices
       SET status = 'offline'
       WHERE status <> 'offline'
         AND (last_seen IS NULL OR last_seen < now() - ($1 * interval '1 second'))
       RETURNING device_id`,
      [seconds]
    );

    return res.json({
      threshold_seconds: seconds,
      marked_offline: result.rowCount,
      device_ids: result.rows.map((r) => r.device_id),
    });
  })
);

module.exports = router;
