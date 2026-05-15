// Telemetry ingest endpoint.
const express = require('express');
const db = require('../db/pool');
const { validateTelemetry } = require('../domain/validation');

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// POST /api/v1/telemetry  -- receive one telemetry frame from a device.
//
// Flow: validate -> confirm device is registered -> persist frame ->
// refresh the device's last_seen / status. The last_seen update is what
// makes the offline-sweep meaningful.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const errors = validateTelemetry(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    const { device_id, temperature, signal_strength, battery_level } = req.body;
    // Accept a device-supplied timestamp; fall back to server time.
    const timestamp = req.body.timestamp
      ? new Date(req.body.timestamp)
      : new Date();
    if (Number.isNaN(timestamp.getTime())) {
      return res
        .status(400)
        .json({ error: 'Validation failed', details: ['timestamp is not a valid date'] });
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // Mark the device seen. 0 rows => the device was never registered,
      // so we reject the frame instead of storing an orphan reading.
      const seen = await client.query(
        `UPDATE devices
         SET last_seen = $2, status = 'online'
         WHERE device_id = $1
         RETURNING device_id`,
        [device_id, timestamp]
      );

      if (seen.rowCount === 0) {
        await client.query('ROLLBACK');
        return res
          .status(404)
          .json({ error: `Device '${device_id}' is not registered` });
      }

      const inserted = await client.query(
        `INSERT INTO telemetry
           (device_id, temperature, signal_strength, battery_level, timestamp)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING telemetry_id, device_id, temperature, signal_strength,
                   battery_level, timestamp`,
        [device_id, temperature, signal_strength, battery_level, timestamp]
      );

      await client.query('COMMIT');
      return res.status(201).json(inserted.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  })
);

module.exports = router;
