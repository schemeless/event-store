# Example Service

## Overview

The example service demonstrates how to build a full-featured Node.js application on top of `@schemeless/event-store`. It wires together Koa, Apollo Server, and TypeGraphQL to expose both GraphQL and REST APIs backed by the event store and a projective read model managed through TypeORM. Domain logic and TypeORM entities are provided by the reusable packages that live in [`examples/example-domain-pacakges`](../example-domain-pacakges/).

## Project layout

- `src/bootstrap.ts` – creates the Koa application, mounts authentication, REST, and GraphQL routes, and configures shared middleware such as sessions, request bodies, logging, and Sentry error reporting.
- `src/managers/` – adapters for cross-cutting services (Apollo Server, event store, Koa, logging, Sentry, TypeORM).
- `src/api/` – API surface, including Passport authentication routes plus GraphQL resolvers for accounts, orders, attachments, posts, profiles, and admin operations.
- `src/cli/` – task scripts that reset the databases, replay the event store, seed sample data, and synchronize schemas. The compiled versions live under `dist/initial` for production use.
- `schema.gql` – generated GraphQL schema for reference.
- `Dockerfile` and `serverlessHandler.js` – entry points for containerized and serverless deployments.

## Prerequisites

- **Node.js** 12 or newer for local development (the provided Dockerfile is based on `node:12.16.2`).
- **MySQL** instances for the event store (`eventstore` database) and projective read model (`balance` database). The defaults expect the databases to be reachable via `mysql://root:M0cFd80FAFOjIajY0_c@localhost:3308/event-store` and `mysql://root:M0cFd80FAFOjIajY0_c@localhost:3307/service` respectively.
- **Redis** at `redis://127.0.0.1:6379/0` for coordinating the event processing queues.
- Optional integrations for Sentry, Auth0, and Weixin/WeChat if you intend to exercise the authentication flows or external storage backends.

## Installation

1. Install repository dependencies from the monorepo root with `yarn install` to make sure shared packages (such as `@schemeless/event-store`) are built.
2. Change into this example package: `cd examples/example-service`.
3. Install service-level dependencies with your preferred package manager (`yarn install` or `npm install`).

## Configuration

Runtime settings are read from environment variables (populate a local `.env` file or export them in your shell). Defaults are provided for developer convenience:

| Variable                                                                                              | Default                                                       | Purpose                                                                         |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `NODE_ENV`                                                                                            | `development`                                                 | Controls dev-mode behaviour (affects logging and connection handling).          |
| `APP_SECRET`                                                                                          | `secret`                                                      | Session encryption key for Koa.                                                 |
| `BALANCE_SNAPSHOT_DB_URL`                                                                             | `mysql://root:M0cFd80FAFOjIajY0_c@localhost:3307/service`     | Connection string for the projective MySQL database.                            |
| `EVENT_SOURCE_DB_URL`                                                                                 | `mysql://root:M0cFd80FAFOjIajY0_c@localhost:3308/event-store` | Connection string for the event store MySQL database.                           |
| `EVENT_SOURCE_REDIS_URL`                                                                              | `redis://127.0.0.1:6379/0`                                    | Redis instance for event queues.                                                |
| `LOGGER_NAME`                                                                                         | `service`                                                     | Identifier used by the Pino logger.                                             |
| `SENTRY_DSN`                                                                                          | _(empty)_                                                     | Enables Sentry tracing when set.                                                |
| `ADMIN_USER_IDS`                                                                                      | `akinoniku`                                                   | Comma-separated list of users granted the `ADMIN` role.                         |
| `HACK_HEADER`                                                                                         | _(empty)_                                                     | Optional shared secret header used to bypass Passport for trusted services.     |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESSkEY`, `S3_BUCKET_NAME_ATTACHMENT`                                | _(empty / `s3-bucket-name`)_                                  | Credentials for AWS S3 attachments when `ATTACHMENT_USE` is set to `AWS`.       |
| `TENCENT_SECRET_ID`, `TENCENT_SECRET_KEY`, `TENCENT_COS_REGION`, `TENCENT_COS_BUCKET_NAME_ATTACHMENT` | _(empty / `ap-guangzhou`)_                                    | Tencent COS credentials for attachment storage.                                 |
| `WEIXIN_CLIENT_ID`, `WEIXIN_CLIENT_SECRET`, `WEIXIN_CALLBACK_DOMAIN`                                  | _(empty)_                                                     | Settings for the Weixin/WeChat Passport strategy.                               |
| `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_DOMAIN`, `AUTH0_CALLBACK_DOMAIN`                     | _(empty)_                                                     | Settings for the Auth0 Passport strategy.                                       |
| `ATTACHMENT_USE`                                                                                      | `TC`                                                          | Selects `TC` (Tencent COS) or `AWS` for attachment handling.                    |
| `WAIT_QUEUE_PREFIX`                                                                                   | `service`                                                     | Prefix for the event-processing wait queue.                                     |
| `APPLY_QUEUE_PREFIX`                                                                                  | _(HOST or random UUID)_                                       | Prefix for the per-instance apply queue (useful when running multiple workers). |

## Database management tasks

The CLI scripts under `src/cli` are exposed through package scripts for convenience:

- `npm run dev:db:sync` – synchronize TypeORM schemas for both the event store and projective databases using TypeScript sources.
- `npm run dev:db:seed` – load the scripted seed data (handy for demos).
- `npm run dev:db:resetStore` – drop and recreate both databases from scratch.
- `npm run dev:db:replayStore` – rebuild the projective read model by replaying stored events.

When you compile the project (`npm run compile`), equivalent JavaScript tasks are emitted under `dist/initial` and can be executed with the matching `db:*` scripts.

## Running locally

1. Ensure the databases and Redis are available and environment variables are set.
2. Start the development server with `npm run start` (uses `ts-node-dev` and streams structured logs through `pino-pretty`).
3. The HTTP server listens on `http://localhost:4000` by default.
   - REST: `GET /api/rest/me` returns the authenticated user profile.
   - GraphQL: `POST /api/graphql` exposes the TypeGraphQL schema described in `schema.gql`.

Each request receives an `x-correlation-id` header for tracing, and errors are forwarded to Sentry when configured.

## Authentication

Passport.js is configured with both Auth0 and Weixin strategies. Successful logins populate the event store with `ProfileIdentityCreated` events and hydrate the read model. For trusted automation, you can set `HACK_HEADER` and pass `x-hack-header`, `x-remote-user`, and `x-remote-user-role` headers to inject user identity and roles without a Passport session.

## Event sourcing integration

`EventStoreService` is bootstrapped with all of the event flows exported from the example domain packages. It manages:

- persistence of domain events in MySQL,
- Redis-backed wait/apply queues for processing,
- replaying events into the projective database, and
- helper methods used by the GraphQL resolvers to issue commands and read projections.

The GraphQL resolvers demonstrate typical usage patterns, including command handling (creating accounts, placing orders, creating posts), administrative maintenance (replaying or resetting the store), and querying read models.

## Testing

Execute `npm test` to run the Jest suite. Tests run against in-memory SQLite databases and a dedicated in-memory event store configuration, so they do not require MySQL or Redis.

## Building for production

- `npm run compile` transpiles the TypeScript sources into `dist/`.
- `npm run prod:start` launches the compiled server (used by the `Dockerfile`).
- `serverlessHandler.js` exposes a Lambda-compatible handler that wraps the compiled `startServerless` entry point with `serverless-http` and Sentry reporting.

Use the provided Dockerfile as a reference for container deployments: copy prebuilt `node_modules` and `dist/`, expose port `4000`, and run `npm run prod:start`.
