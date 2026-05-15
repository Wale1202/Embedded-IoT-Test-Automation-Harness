// Liveness + dependency check. Used by humans, CI, and load balancers.
const express = require('express');
const db = require('../db/pool');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', db: 'up' });
  } catch (err) {
    // DB down: report unhealthy so orchestration can react.
    res.status(503).json({ status: 'degraded', db: 'down' });
  }
});

module.exports = router;
