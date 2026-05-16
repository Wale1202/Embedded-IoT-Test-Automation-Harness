// Device lifecycle: register, status, history, per-device event log,
// and the offline sweep (failure scenario 3).
const express = require('express');
const db = require('../db/pool');
const config = require('../config');
const asyncHandler = require('../asyncHandler');
const events = require('../events');
const { validateDeviceRegistration } = require('../validation');

const router = express.Router();

// POST /api/v1/devices  -- register a device.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const errors = validateDeviceRegistration(req.body);
    if (errors.length > 0) {
      return res
        .status(400)
        .json({ error: 'Validation failed', details: errors });
    }
    const { device_id, device_name, firmware_version } = req.body;

    // ON CONFLICT DO NOTHING => re-registering the same id is a clean
    // 409, not a silent overwrite.
    const r = await db.query(
      `INSERT INTO devices (device_id, device_name, firmware_version, status)
       VALUES ($1, $2, $3, 'offline')
       ON CONFLICT (device_id) DO NOTHING
       RETURNING device_id, device_name, firmware_version, status, last_seen`,
      [device_id, device_name, firmware_version]
    );
    if (r.rowCount === 0) {
      return res
        .status(409)
        .json({ error: `Device '${device_id}' is already registered` });
    }
    return res.status(201).json(r.rows[0]);
  })
);

// GET /api/v1/devices  -- list every device with its latest telemetry.
// The LATERAL join fetches each device's most recent frame in one
// query, so the dashboard needs a single request instead of N+1.
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const r = await db.query(
      `SELECT d.device_id, d.device_name, d.firmware_version,
              d.status, d.last_seen,
              t.temperature, t.signal_strength, t.battery_level,
              t.timestamp AS latest_telemetry_at
       FROM devices d
       LEFT JOIN LATERAL (
         SELECT temperature, signal_strength, battery_level, timestamp
         FROM telemetry
         WHERE device_id = d.device_id
         ORDER BY timestamp DESC
         LIMIT 1
       ) t ON true
       ORDER BY d.device_id`
    );
    return res.json({ count: r.rowCount, devices: r.rows });
  })
);

// POST /api/v1/devices/offline-sweep  -- scenario 3: mark every device
// that has been silent too long as offline, AND log one DEVICE_OFFLINE
// event per device, in a single statement so they can't diverge.
router.post(
  '/offline-sweep',
  asyncHandler(async (_req, res) => {
    const seconds = config.offlineThresholdSeconds;
    const r = await db.query(
      `WITH swept AS (
         UPDATE devices SET status = 'offline'
         WHERE status <> 'offline'
           AND (last_seen IS NULL
                OR last_seen < now() - ($1 * interval '1 second'))
         RETURNING device_id
       ), logged AS (
         INSERT INTO device_events (device_id, event_type, severity, description)
         SELECT device_id, 'DEVICE_OFFLINE', 'warning',
                'Device marked offline: no telemetry within ' || $1 || 's'
         FROM swept
       )
       SELECT device_id FROM swept`,
      [seconds]
    );
    return res.json({
      threshold_seconds: seconds,
      marked_offline: r.rowCount,
      device_ids: r.rows.map((row) => row.device_id),
    });
  })
);

// GET /api/v1/devices/:deviceId/status  -- latest known device state.
router.get(
  '/:deviceId/status',
  asyncHandler(async (req, res) => {
    const r = await db.query(
      `SELECT device_id, device_name, firmware_version, status, last_seen
       FROM devices WHERE device_id = $1`,
      [req.params.deviceId]
    );
    if (r.rowCount === 0) {
      return res
        .status(404)
        .json({ error: `Device '${req.params.deviceId}' not found` });
    }
    return res.json(r.rows[0]);
  })
);

// GET /api/v1/devices/:deviceId/history?limit=N  -- telemetry, newest first.
router.get(
  '/:deviceId/history',
  asyncHandler(async (req, res) => {
    const { deviceId } = req.params;
    const requested = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requested)
      ? Math.min(Math.max(requested, 1), 500)
      : 50;

    const d = await db.query('SELECT 1 FROM devices WHERE device_id = $1', [
      deviceId,
    ]);
    if (d.rowCount === 0) {
      return res.status(404).json({ error: `Device '${deviceId}' not found` });
    }

    const r = await db.query(
      `SELECT telemetry_id, device_id, temperature, signal_strength,
              battery_level, timestamp
       FROM telemetry
       WHERE device_id = $1
       ORDER BY timestamp DESC
       LIMIT $2`,
      [deviceId, limit]
    );
    return res.json({
      device_id: deviceId,
      count: r.rowCount,
      events: r.rows,
    });
  })
);

// GET /api/v1/devices/:deviceId/events?severity=&type=&limit=N
router.get(
  '/:deviceId/events',
  asyncHandler(async (req, res) => {
    const requested = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requested)
      ? Math.min(Math.max(requested, 1), 500)
      : 50;
    const rows = await events.listEvents({
      deviceId: req.params.deviceId,
      severity: req.query.severity,
      type: req.query.type,
      limit,
    });
    return res.json({
      device_id: req.params.deviceId,
      count: rows.length,
      events: rows,
    });
  })
);

module.exports = router;
