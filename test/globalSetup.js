// Runs ONCE before the whole suite: ensure the schema exists. Uses the
// same idempotent migration runner the CLI uses, then closes its pool
// so it doesn't leak into the test workers.
process.env.NODE_ENV = 'test';

module.exports = async () => {
  const { migrate } = require('../src/db/migrate');
  const db = require('../src/db/pool');
  try {
    await migrate();
  } catch (err) {
    // Fail loudly and early: a missing DB is the #1 setup mistake.
    console.error(
      '\n[test setup] Could not migrate the test database.\n' +
        'Is PostgreSQL running?  docker compose up -d\n' +
        `Reason: ${err.message}\n`
    );
    throw err;
  } finally {
    await db.pool.end();
  }
};
