// Tests share one PostgreSQL database and TRUNCATE between cases, so
// they must run serially (the npm script also passes --runInBand).
module.exports = {
  testEnvironment: 'node',
  // Apply the schema once before any test file runs.
  globalSetup: './test/globalSetup.js',
  // Truncate tables before each test + close the pool after each file.
  setupFilesAfterEnv: ['./test/setup.js'],
  testMatch: ['**/test/**/*.test.js'],
  testTimeout: 10000,
};
