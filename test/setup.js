// Per-file hooks (Jest setupFilesAfterEnv):
//   - before EVERY test: reset the database to a clean state
//   - after the file:     close the connection pool (no open handles)
const { resetDatabase, closePool } = require('./helpers/db');

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closePool();
});
