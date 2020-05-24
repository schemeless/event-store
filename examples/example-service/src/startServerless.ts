import 'reflect-metadata';
import './managers/sentry/sentry';
import serverless from 'serverless-http';
import { bootstrap } from './bootstrap';
import { logger } from './managers/pino';

logger.info(`Serverless Bootstrap Start..`);
const koaApp = bootstrap();
export const handler = serverless(koaApp);
