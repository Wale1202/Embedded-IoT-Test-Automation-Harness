// Minimal migration runner: executes every .sql file in migrations/
// in filename order. Each file is idempotent, so re-running is safe
// (good enough here; a real project would track applied versions in a
// schema_migrations table).
const fs = require('fs');
const path = require('path');
const db = require('./pool');

async function migrate() {
  const dir = path.join(__dirname, 'migrations');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    console.log(`Applying migration: ${file}`);
    await db.query(sql);
  }
  console.log(`Migrations complete (${files.length} file(s))`);
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err.message);
    process.exit(1);
  });
