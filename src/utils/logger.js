// Tiny structured logger. Kept dependency-free for the MVP; a real
// deployment would swap this for pino/winston without changing callers.
function log(level, message, meta) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta } : {}),
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(entry));
}

module.exports = {
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),
};
