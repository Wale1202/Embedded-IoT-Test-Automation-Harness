// GET /api/v1/events?severity=&type=&limit=N  -- the whole event log
// across all devices (failure/anomaly audit trail).
const express = require('express');
const asyncHandler = require('../asyncHandler');
const events = require('../events');

const router = express.Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const requested = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requested)
      ? Math.min(Math.max(requested, 1), 500)
      : 50;
    const rows = await events.listEvents({
      severity: req.query.severity,
      type: req.query.type,
      limit,
    });
    return res.json({ count: rows.length, events: rows });
  })
);

module.exports = router;
