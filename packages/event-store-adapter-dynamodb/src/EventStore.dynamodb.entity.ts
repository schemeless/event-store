import { attribute, hashKey, rangeKey, table } from '@aws/dynamodb-data-mapper-annotations';
import type { CustomType } from '@aws/dynamodb-data-marshaller';
import type { IEventStoreEntity } from '@schemeless/event-store-types';
import { GlobalSecondaryIndexOptions } from '@aws/dynamodb-data-mapper/build/namedParameters/SecondaryIndexOptions';
import { AttributeValue } from 'aws-sdk/clients/dynamodb';

const DateType: CustomType<Date> = {
  type: 'Custom',
  attributeType: 'S',
  marshall: (input: Date): AttributeValue => ({ S: input.toISOString() }),
  unmarshall: (persistedValue: AttributeValue): Date => new Date(persistedValue.S!),
};

const PayloadType: CustomType<any> = {
  type: 'Custom',
  attributeType: 'S',
  marshall(input: any) {
    return { S: JSON.stringify(input) };
  },
  unmarshall(persistedValue) {
    const s = persistedValue.S;
    return JSON.parse(s);
  },
};

export const TIME_BUCKET_INDEX = 'timeBucketIndex';
export const CAUSATION_INDEX = 'causationIndex';

export const dateIndexGSIOptions: GlobalSecondaryIndexOptions = {
  type: 'global',
  projection: 'keys',
  readCapacityUnits: 10,
  writeCapacityUnits: 5,
};

@table('schemeless-event-store')
export class EventStoreEntity implements IEventStoreEntity<any, any> {
  // Main Table PK: EventID (Preserve O(1) Lookup)
  @hashKey({
    type: 'Custom',
    attributeType: 'S',
    marshall: (str) => ({ S: `EventID#${str}` }),
    unmarshall: (persisted) => persisted.S!.replace(/^EventID#/, ''),
  })
  id: string;

  @attribute({ type: 'String' })
  domain: string;

  @attribute({ type: 'String' })
  type: string;

  @attribute({ type: 'Any' })
  meta?: string;

  @attribute(PayloadType)
  payload: string;

  @attribute({ type: 'String' })
  s3Reference?: string;

  @attribute({ type: 'String' })
  identifier?: string;

  @attribute({ type: 'String' })
  correlationId?: string;

  @attribute({
    type: 'String',
    indexKeyConfigurations: {
      [CAUSATION_INDEX]: 'HASH',
    }
  })
  causationId?: string;

  // Global TimeBucket for Replay
  @attribute({
    type: 'String',
    indexKeyConfigurations: {
      [TIME_BUCKET_INDEX]: 'HASH',
    }
  })
  timeBucket: string;

  @rangeKey(
    Object.assign(DateType, {
      indexKeyConfigurations: {
        [TIME_BUCKET_INDEX]: 'RANGE',
        [CAUSATION_INDEX]: 'RANGE'
      },
    })
  )
  created: Date;

  // Helper to generate bucket ID
  generateTimeBucket() {
    // Bucket by Month to reduce partition count for global replay
    // Format: YYYY-MM
    if (this.created) {
      this.timeBucket = this.created.toISOString().slice(0, 7);
    }
  }
}
