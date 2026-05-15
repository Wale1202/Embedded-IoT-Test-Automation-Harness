// POST /api/v1/telemetry  -- receive one telemetry frame.
//
// This is the core of the project. Read top to bottom; each block is
// one failure scenario. The rule throughout:
//   invalid data is REJECTED;  degraded-but-valid data is STORED + FLAGGED.
const express = require('express');
const db = require('../db/pool');
const asyncHandler = require('../asyncHandler');
const events = require('../events');
const {
  validateTelemetry,
  detectValueAnomalies,
  detectTimestampAnomaly,
} = require('../validation');

const router = express.Router();

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const deviceIdForLog =
      typeof body.device_id === 'string' && body.device_id.trim()
        ? body.device_id
        : null;

    // --- Scenario 5 (missing fields) + Scenario 4 (extreme values) -----
    const errors = validateTelemetry(body);
    if (errors.length > 0) {
      const missing = errors.filter(
        (e) => e.code === 'MISSING' || e.code === 'TYPE'
      );
      const range = errors.filter((e) => e.code === 'RANGE');

      if (missing.length > 0) {
        await events.recordEvent({
          deviceId: deviceIdForLog,
          type: events.EVENT_TYPES.MISSING_FIELDS,
          severity: events.SEVERITY.WARNING,
          description: `Invalid/missing fields: ${missing.map((e) => e.field).join(', ')}`,
        });
      }
      if (range.length > 0) {
        await events.recordEvent({
          deviceId: deviceIdForLog,
          type: events.EVENT_TYPES.EXTREME_VALUE,
          severity: events.SEVERITY.CRITICAL,
          description: `Out-of-range sensor values: ${range.map((e) => e.message).join('; ')}`,
        });
      }
      return res
        .status(400)
        .json({ error: 'Validation failed', details: errors.map((e) => e.message) });
    }

    const clientTs = body.timestamp != null ? new Date(body.timestamp) : null;
    const timestamp = clientTs || new Date();
    const { device_id, temperature, signal_strength, battery_level } = body;

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // --- Scenario 7: telemetry from an unregistered device ----------
      const device = await client.query(
        'SELECT 1 FROM devices WHERE device_id = $1',
        [device_id]
      );
      if (device.rowCount === 0) {
        await client.query('ROLLBACK');
        await events.recordEvent({
          deviceId: device_id,
          type: events.EVENT_TYPES.UNREGISTERED_DEVICE,
          severity: events.SEVERITY.ERROR,
          description: `Telemetry received from unregistered device '${device_id}'`,
        });
        return res
          .status(404)
          .json({ error: `Device '${device_id}' is not registered` });
      }

      // --- Scenario 2: duplicate telemetry ----------------------------
      // Only checkable when the device sends its own timestamp; a
      // server-assigned timestamp is unique by construction.
      if (clientTs) {
        const dup = await client.query(
          'SELECT 1 FROM telemetry WHERE device_id = $1 AND timestamp = $2',
          [device_id, timestamp]
        );
        if (dup.rowCount > 0) {
          await client.query('ROLLBACK');
          await events.recordEvent({
            deviceId: device_id,
            type: events.EVENT_TYPES.DUPLICATE_TELEMETRY,
            severity: events.SEVERITY.WARNING,
            description: `Duplicate telemetry for '${device_id}' at ${timestamp.toISOString()}`,
          });
          return res.status(409).json({
            error: 'Duplicate telemetry frame',
            detail: `A frame for '${device_id}' at ${timestamp.toISOString()} already exists`,
          });
        }
      }

      // Accepted: store the frame and mark the device alive.
      await client.query(
        `UPDATE devices SET last_seen = $2, status = 'online'
         WHERE device_id = $1`,
        [device_id, timestamp]
      );
      const inserted = await client.query(
        `INSERT INTO telemetry
           (device_id, temperature, signal_strength, battery_level, timestamp)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING telemetry_id, device_id, temperature, signal_strength,
                   battery_level, timestamp`,
        [device_id, temperature, signal_strength, battery_level, timestamp]
      );
      await client.query('COMMIT');

      // --- Scenario 6 + soft anomalies: accepted, but flagged ---------
      // Logged AFTER commit so a logging hiccup can't lose telemetry.
      const anomalies = detectValueAnomalies({
        temperature,
        signal_strength,
        battery_level,
      });
      const tsAnomaly = detectTimestampAnomaly(clientTs);
      if (tsAnomaly) anomalies.push(tsAnomaly);

      for (const a of anomalies) {
        await events.recordEvent({
          deviceId: device_id,
          type: a.type,
          severity: a.severity,
          description: a.description,
        });
      }

      return res.status(201).json({
        ...inserted.rows[0],
        warnings: anomalies.map((a) => ({
          type: a.type,
          description: a.description,
        })),
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err; // forwarded to the error handler by asyncHandler
    } finally {
      client.release();
    }
  })
);

module.exports = router;
