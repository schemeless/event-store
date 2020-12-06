import { attribute, hashKey, table } from '@aws/dynamodb-data-mapper-annotations';
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

export const dateIndexGSIOptions: GlobalSecondaryIndexOptions = {
  type: 'global',
  projection: 'all',
  readCapacityUnits: 10,
  writeCapacityUnits: 5,
};

@table('schemeless-event-store')
export class EventStoreEntity implements IEventStoreEntity<any, any> {
  @hashKey({
    type: 'String',
    indexKeyConfigurations: {
      created: 'RANGE',
    },
  })
  id: string;

  @attribute({ type: 'String' })
  domain: string;

  @attribute({ type: 'String' })
  type: string;

  @attribute({ type: 'Any' })
  meta?: string;

  @attribute({ type: 'Any' })
  payload: string;

  @attribute({ type: 'String' })
  identifier?: string;

  @attribute({ type: 'String' })
  correlationId?: string; //uuid

  @attribute({ type: 'String' })
  causationId?: string; //uuid

  @attribute(
    Object.assign(DateType, {
      indexKeyConfigurations: {
        created: 'HASH',
      },
    })
  )
  created: Date;
}
