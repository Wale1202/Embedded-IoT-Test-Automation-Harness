// Process entrypoint: start the HTTP server.
const app = require('./app');
const config = require('./config');
const logger = require('./utils/logger');

app.listen(config.port, () => {
  logger.info('Telemetry harness listening', { port: config.port });
});
