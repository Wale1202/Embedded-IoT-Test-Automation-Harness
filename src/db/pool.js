// A single shared PostgreSQL connection pool for the whole process.
const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({ connectionString: config.databaseUrl });

// Thin wrapper so call sites read as `db.query(sql, params)`.
module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
