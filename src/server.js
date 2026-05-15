// Process entrypoint: start the HTTP server.
const app = require('./app');
const config = require('./config');

app.listen(config.port, () => {
  console.log(`Telemetry harness listening on port ${config.port}`);
});
