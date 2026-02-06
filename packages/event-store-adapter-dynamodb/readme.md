# @schemeless/event-store-adapter-dynamodb

A production-ready DynamoDB-backed implementation of the `IEventStoreRepo` contract. It pairs AWS SDK v3 with optional S3 offloading and an efficient time-bucketed iteration strategy.

## Installation

```bash
yarn add @schemeless/event-store-adapter-dynamodb @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/client-s3 @aws-sdk/lib-storage
```

## Usage

```ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { EventStoreRepo as EventStoreDynamoRepo } from '@schemeless/event-store-adapter-dynamodb';
import { makeEventStore } from '@schemeless/event-store';

const dynamodbClient = new DynamoDBClient({ region: 'us-east-1' });
const s3Client = new S3Client({ region: 'us-east-1' });

const repo = new EventStoreDynamoRepo(dynamodbClient, s3Client, {
  tableNamePrefix: 'prod-',
  s3BucketName: 'my-event-archive',
  eventStoreTableReadCapacityUnits: 20,
  eventStoreTableWriteCapacityUnits: 10,
});

const buildStore = makeEventStore(repo);
const eventStore = await buildStore(eventFlows);
```

### Breaking Changes in v2.0.0+ (Released in 2.8.1)
> [!WARNING]
> **Schema Change**: This version introduces a new indexing strategy. Existing DynamoDB tables are not compatible.
> - **Primary Key**: `EventID` (id) remains unchanged.
> - **New GSIs**: Added `timeBucketIndex` and `causationIndex`.
> - **Conditional Writes**: Now uses `attribute_not_exists(id)` to ensure event id uniqueness and prevent accidental overwrites.

When `init` runs, the repository ensures the DynamoDB table and the new Global Secondary Indexes exist. Persisted events larger than ~350KB are automatically serialised to S3 and replaced with a bucket/key reference.

## Event streaming

`getAllEvents` returns an async iterator that uses **Time Bucketing** (partitioned by month). Instead of scanning the entire table, it queries specific time buckets, making it safe to replay millions of events without excessive memory consumption or timing out.

The iterator includes:
- **Automatic retry with exponential backoff** for transient DynamoDB errors
- **UnprocessedKeys handling** to ensure no data is lost during BatchGet throttling
- **Parallel S3 fetching** for events with large payloads stored in S3

## Resetting state

Call `resetStore` to drop and recreate the DynamoDB table. This is handy for integration tests where you need a clean slate.

