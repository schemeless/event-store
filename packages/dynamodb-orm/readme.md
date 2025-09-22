# @schemeless/dynamodb-orm

Utility helpers for building DynamoDB repositories with the AWS Data Mapper. The package keeps table metadata on your entity classes, exposes a cached manager that bootstraps tables on first use, and ships a reusable `DateType` marshaller for ISO string persistence.

## Installation

```bash
yarn add @schemeless/dynamodb-orm @aws/dynamodb-data-mapper aws-sdk
```

`aws-sdk` is a peer dependency so you can control credentials and region resolution.

## Define an entity

Use your regular Data Mapper annotations and add the provided `repo` decorator so the helper knows which table and create options to use when initialising the repository.

```ts
import { attribute, hashKey, table } from '@aws/dynamodb-data-mapper-annotations';
import { repo, DateType } from '@schemeless/dynamodb-orm';

@table('user-events')
@repo('user-events', {
  readCapacityUnits: 5,
  writeCapacityUnits: 5,
})
class UserEvent {
  @hashKey()
  id!: string;

  @attribute(DateType)
  created!: Date;

  @attribute()
  payload!: Record<string, unknown>;
}
```

The decorator stores the table name and creation settings on the entity prototype, and the exported `DateType` converts between JavaScript `Date` objects and ISO8601 strings when writing to DynamoDB.

## Create and reuse a manager

`makeGetDynamoDbManager` wires the AWS client configuration, table prefix, and entity metadata together. The returned function lazily creates a `DynamodbManager` per entity, ensures the table exists, and caches the instance for later calls so subsequent requests reuse the same mapper and repo.

```ts
import { DynamoDB } from 'aws-sdk';
import { makeGetDynamoDbManager } from '@schemeless/dynamodb-orm';

const getManager = makeGetDynamoDbManager('dev-', { region: 'us-east-1' });

async function saveEvent(event: UserEvent) {
  const manager = await getManager(UserEvent);
  await manager.repo.put(event);
}
```

Each `DynamodbManager` exposes a Data Mapper client and the strongly-typed repository wrapper with convenience methods such as `put`, `get`, `query`, and `ensureTableExists` so you can focus on domain logic instead of boilerplate persistence code.
