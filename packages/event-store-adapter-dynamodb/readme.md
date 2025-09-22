# @schemeless/event-store-adapter-dynamodb

A DynamoDB-backed implementation of the `IEventStoreRepo` contract. It pairs the AWS Data Mapper with optional S3 offloading so oversized payloads are stored outside the main table while the event store runtime keeps working with plain JavaScript objects.

## Installation

```bash
yarn add @schemeless/event-store-adapter-dynamodb @aws/dynamodb-data-mapper @aws/dynamodb-data-mapper-annotations aws-sdk
```

The package expects `aws-sdk` clients for DynamoDB and S3. You can reuse existing credentials, region, or endpoint overrides when constructing those clients.

## Usage

```ts
import { DynamoDB, S3 } from 'aws-sdk';
import { EventStoreRepo as EventStoreDynamoRepo } from '@schemeless/event-store-adapter-dynamodb';
import { makeEventStore } from '@schemeless/event-store';

const dynamodb = new DynamoDB({ region: 'us-east-1' });
const s3 = new S3({ region: 'us-east-1' });

const repo = new EventStoreDynamoRepo(dynamodb, s3, {
  tableNamePrefix: 'prod-',
  s3BucketName: 'my-event-archive',
  eventStoreTableReadCapacityUnits: 20,
  eventStoreTableWriteCapacityUnits: 10,
});

const buildStore = makeEventStore(repo);
const eventStore = await buildStore(eventFlows);
```

When `init` runs the repository ensures the DynamoDB table and secondary index exist (unless skipped) and optionally creates the backing S3 bucket. Persisted events larger than ~350KB are automatically serialised to S3 and replaced with a bucket/key reference so your table remains within item size limits.

## Event streaming

`getAllEvents` returns an async iterator that loads pages of item identifiers through a global secondary index, hydrates the full records, resolves S3-backed payloads, and yields events in chronological order. The event store replay helper uses this iterator to rebuild projections consistently across restarts.

## Resetting state

Call `resetStore` to drop and recreate the DynamoDB table. This is handy for integration tests or local development where you need a clean slate between runs.
