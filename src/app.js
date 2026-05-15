// Builds the Express app but does NOT start listening. Keeping the
// listen() call out of here lets tests drive the app in-process with
// Supertest (next iteration) without binding a real port.
const express = require('express');
const devicesRouter = require('./routes/devices');
const telemetryRouter = require('./routes/telemetry');
const healthRouter = require('./routes/health');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

// Reject malformed JSON bodies with a clean 400 instead of a stack trace.
app.use(express.json());
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON' });
  }
  return next(err);
});

app.use('/health', healthRouter);
app.use('/api/v1/devices', devicesRouter);
app.use('/api/v1/telemetry', telemetryRouter);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
