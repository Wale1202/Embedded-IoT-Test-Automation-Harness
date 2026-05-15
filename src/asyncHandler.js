// Wraps an async route handler so a rejected promise is forwarded to
// the Express error handler instead of crashing the process. This is
// why the routes below can be written without a try/catch around every
// database call.
module.exports = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
