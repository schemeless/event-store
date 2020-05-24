import { ApolloServer } from 'apollo-server-koa';
import { GraphQLSchema } from 'graphql';
import { logger } from '..';
import { apolloContext } from './context';
import * as Sentry from '@sentry/node';

export const getApolloServer = (schema: GraphQLSchema): ApolloServer => {
  // Create GraphQL server
  return new ApolloServer({
    schema,
    introspection: true,
    context: apolloContext,
    logger: logger,
    formatError: err => {
      logger.error(err);
      Sentry.setTag('from', 'apollo');
      Sentry.captureException(err);
      return err;
    }
  });
};
