// 404 for unknown routes.
function notFound(req, res) {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
}

// Any thrown / next(err) error lands here, so we never leak a stack
// trace to the client and always log it server-side.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error('[error]', req.method, req.path, '-', err.message);
  res.status(err.status || 500).json({ error: 'Internal server error' });
}

module.exports = { notFound, errorHandler };
