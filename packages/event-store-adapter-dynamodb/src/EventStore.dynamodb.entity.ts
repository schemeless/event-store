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

export const dateIndexName = 'eventCreated';

export const dateIndexGSIOptions: GlobalSecondaryIndexOptions = {
  type: 'global',
  projection: 'keys',
  readCapacityUnits: 10,
  writeCapacityUnits: 5,
};

@table('schemeless-event-store')
export class EventStoreEntity implements IEventStoreEntity<any, any> {
  @hashKey({
    type: 'Custom',
    attributeType: 'S',
    marshall: (str) => ({ S: `EventID#${str}` }),
    unmarshall: (persisted) => persisted.S!.replace(/^EventID#/, ''),
    indexKeyConfigurations: {
      [dateIndexName]: 'RANGE',
    },
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
  correlationId?: string; //uuid

  @attribute({ type: 'String' })
  causationId?: string; //uuid

  @rangeKey(
    Object.assign(DateType, {
      indexKeyConfigurations: {
        [dateIndexName]: 'HASH',
      },
    })
  )
  created: Date;
}
