// Centralised configuration. All environment access happens here so the
// rest of the code never touches process.env directly (easier to test).
require('dotenv').config();

const num = (envVal, fallback) => {
  const n = parseInt(envVal, 10);
  return Number.isFinite(n) ? n : fallback;
};
const float = (envVal, fallback) => {
  const n = parseFloat(envVal);
  return Number.isFinite(n) ? n : fallback;
};

const config = {
  port: num(process.env.PORT, 3000),
  // Jest sets NODE_ENV=test. If TEST_DATABASE_URL is provided we use it,
  // so the suite (which TRUNCATEs tables) can run against a throwaway
  // database instead of the dev one.
  databaseUrl:
    (process.env.NODE_ENV === 'test' && process.env.TEST_DATABASE_URL) ||
    process.env.DATABASE_URL ||
    'postgres://harness:harness@localhost:5432/harness',

  // A device is swept to "offline" if it has not sent telemetry within
  // this many seconds (used by the offline-sweep endpoint).
  offlineThresholdSeconds: num(process.env.OFFLINE_THRESHOLD_SECONDS, 60),

  // Soft anomaly thresholds. Telemetry crossing these is still accepted
  // and stored, but a warning event is logged (real fleets monitor
  // degradation, they don't just reject it).
  staleTimestampSeconds: num(process.env.STALE_TIMESTAMP_SECONDS, 300),
  clockSkewFutureSeconds: num(process.env.CLOCK_SKEW_FUTURE_SECONDS, 60),
  batteryLowPct: float(process.env.BATTERY_LOW_PCT, 15),
  signalWeakDbm: float(process.env.SIGNAL_WEAK_DBM, -100),
  tempHighC: float(process.env.TEMP_HIGH_C, 85),
};

module.exports = config;
