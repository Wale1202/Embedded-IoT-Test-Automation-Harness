// Minimal migration runner: executes every .sql file in migrations/
// in filename order. Each file is written to be idempotent, so re-running
// is safe (good enough for the MVP; a real project would track applied
// versions in a schema_migrations table).
const fs = require('fs');
const path = require('path');
const db = require('./pool');
const logger = require('../utils/logger');

async function migrate() {
  const dir = path.join(__dirname, 'migrations');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    logger.info('Applying migration', { file });
    await db.query(sql);
  }
  logger.info('Migrations complete', { count: files.length });
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('Migration failed', { error: err.message });
    process.exit(1);
  });
