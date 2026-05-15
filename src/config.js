// Centralised configuration. All environment access happens here so the
// rest of the code never touches process.env directly (easier to test).
require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgres://harness:harness@localhost:5432/harness',
  // How long a device may stay silent before the offline-sweep marks it down.
  offlineThresholdSeconds:
    parseInt(process.env.OFFLINE_THRESHOLD_SECONDS, 10) || 60,
};

module.exports = config;
