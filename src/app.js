// Builds the Express app but does NOT start listening. The split
// (app here, listen in server.js) lets the test suite drive the API
// in-process with Supertest without binding a real port.
const path = require('path');
const express = require('express');
const devicesRouter = require('./routes/devices');
const telemetryRouter = require('./routes/telemetry');
const eventsRouter = require('./routes/events');
const healthRouter = require('./routes/health');
const events = require('./events');
const { notFound, errorHandler } = require('./errorHandler');

const app = express();

app.use(express.json());

// Scenario 1: malformed telemetry. A body that isn't valid JSON never
// reaches the route, so we catch the parser error here, log it as an
// event (no device_id is knowable), and return a clear 400.
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    if (req.path.startsWith('/api/v1/telemetry')) {
      events.recordEvent({
        type: events.EVENT_TYPES.MALFORMED_TELEMETRY,
        severity: events.SEVERITY.WARNING,
        description: `Malformed JSON body on ${req.method} ${req.path}`,
      });
    }
    return res.status(400).json({ error: 'Request body is not valid JSON' });
  }
  return next(err);
});

// Serve the read-only verification dashboard (a single static file).
// Same origin as the API, so there is no CORS to configure. Unknown
// paths fall through to the API routers below.
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/health', healthRouter);
app.use('/api/v1/devices', devicesRouter);
app.use('/api/v1/telemetry', telemetryRouter);
app.use('/api/v1/events', eventsRouter);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
