'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.handler = async (event, context) => {
  const started = +new Date();
  const logger = require('./dist/managers/pino').logger;
  logger.info(event);
  const startServerless = require('./dist/startServerless');
  try {
    logger.info('Handled in ' + (+new Date() - started).toFixed(0) + 'ms');
    const result = await startServerless.handler(event, context);
    logger.info('Finished in ' + (+new Date() - started).toFixed(0) + 'ms');
    return result;
  } catch (error) {
    const Sentry = require('@sentry/node');
    Sentry.captureException(error);
    await Sentry.flush(1000);
    return error;
  }
};
