import 'reflect-metadata';
import './managers/sentry/sentry';
import { logger } from './managers/pino';
import { bootstrap } from './bootstrap';

const port = 4000;

const start = () => {
  try {
    const koaApp = bootstrap();
    koaApp.listen(port);

    logger.info(`🚀 Server Started: port: ${port}`);
  } catch (e) {
    logger.fatal('bootstrap error', e.message);
    logger.fatal(e.stack);
  }
};

start();
