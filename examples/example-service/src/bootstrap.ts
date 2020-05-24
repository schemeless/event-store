import session from 'koa-session';
import koaBody from 'koa-body';
import passport from 'koa-passport';
import pinoLogger from 'koa-pino-logger';
import * as Sentry from '@sentry/node';
import { Context } from 'koa';
import { v4 as uuid } from 'uuid';
import { logger } from './managers/pino';
import { AllResolverList } from './api/graphql';
import { createSchemaSync } from './managers/typegraphql';
import { getApolloServer } from './managers/apollo-server';
import { getKoaApp } from './managers';
import { restfulRouter } from './api/rest';
import { environment } from './env';
import { authRoute } from './api/auth';

const koaBodyMiddleware = koaBody({
  multipart: true,
  formidable: {
    uploadDir: '/tmp',
    maxFieldsSize: 10 * 1024 * 1024,
    keepExtensions: false
  }
});

export const bootstrap = () => {
  const started = +new Date();
  logger.info('🐛 Starting...');
  const schema = createSchemaSync(AllResolverList, environment.isDev);
  const apolloServer = getApolloServer(schema);

  const koaApp = getKoaApp();
  koaApp.keys = [environment.appSecret];
  koaApp
    .use(async (ctx: Context, next) => {
      // set x-correlation-id
      ctx.set({ 'x-correlation-id': uuid() });
      await next();
    })
    .use(session({}, koaApp))
    .use(koaBodyMiddleware)
    .use(passport.initialize())
    .use(passport.session())
    .use(pinoLogger())
    .use(authRoute.routes())
    .use(authRoute.allowedMethods())
    .use(restfulRouter.routes())
    .use(restfulRouter.allowedMethods())
    .use(apolloServer.getMiddleware({ path: '/api/graphql' }));

  koaApp.on('error', err => {
    logger.error(err);
    Sentry.setTag('from', 'koa');
    Sentry.captureException(err);
  });

  logger.info(`🪐 Auth routes: ${authRoute.stack.map(i => i.path).join(', ')}`);
  logger.info(`🪐 Restful routes: ${restfulRouter.stack.map(i => i.path).join(', ')}`);
  logger.info(`🪐 Graphql routes: ${apolloServer.graphqlPath}`);
  logger.info('🦋 Started in ' + (+new Date() - started).toFixed(0) + 'ms');
  return koaApp;
};
