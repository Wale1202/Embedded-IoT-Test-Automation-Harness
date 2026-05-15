const logger = require('../utils/logger');

// 404 for unknown routes - returned before the error handler.
function notFound(req, res) {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
}

// Central error handler. Any thrown/`next(err)` error lands here so we
// never leak a stack trace to the client and always log it server-side.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  logger.error('Unhandled error', { error: err.message, path: req.path });
  res.status(err.status || 500).json({
    error: err.publicMessage || 'Internal server error',
  });
}

module.exports = { notFound, errorHandler };
