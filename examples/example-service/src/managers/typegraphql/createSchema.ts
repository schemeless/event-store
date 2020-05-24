// import { Container } from "typedi";
import * as path from 'path';
import { buildSchema, buildSchemaSync } from 'type-graphql/dist';
import { GraphQLSchema } from 'graphql';
import { logger } from '..';
import { customAuthChecker } from './customAuthChecker';

export const createSchema = async (resolvers: any[], shouldEmitSchemaFile = true): Promise<GraphQLSchema> => {
  // build TypeGraphQL executable schema
  const schemaPath = path.resolve(__dirname, '..', '..', '..', 'schema.gql');
  const schema = await buildSchema({
    resolvers,
    // automatically create `schema.gql` file with schema definition in current folder
    emitSchemaFile: shouldEmitSchemaFile && schemaPath,
    // container: Container,
    authChecker: customAuthChecker
  });

  logger.info('🗺️ GraphQL schema created');
  return schema;
};

export const createSchemaSync = (resolvers: any[], shouldEmitSchemaFile = true): GraphQLSchema => {
  // build TypeGraphQL executable schema
  const schema = buildSchemaSync({
    resolvers,
    // automatically create `schema.gql` file with schema definition in current folder
    emitSchemaFile: shouldEmitSchemaFile,
    // container: Container,
    authChecker: customAuthChecker
  });

  logger.info('🗺️ GraphQL schema created');
  return schema;
};
