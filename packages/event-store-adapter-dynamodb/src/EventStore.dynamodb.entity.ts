import { attribute, hashKey, rangeKey, table } from '@aws/dynamodb-data-mapper-annotations';
import type { CustomType } from '@aws/dynamodb-data-marshaller';
import type { IEventStoreEntity } from '@schemeless/event-store-types';
import { AttributeValue } from 'aws-sdk/clients/dynamodb';

const DateType: CustomType<Date> = {
  type: 'Custom',
  attributeType: 'S',
  marshall: (input: Date): AttributeValue => ({ S: input.toISOString() }),
  unmarshall: (persistedValue: AttributeValue): Date => new Date(persistedValue.S!),
};

@table('schemeless-event-store')
export class EventStoreEntity implements IEventStoreEntity<any, any> {
  @hashKey({ type: 'String' })
  id: string;

  @attribute({ type: 'String' })
  domain: string;

  @attribute({ type: 'String' })
  type: string;

  @attribute({ type: 'Any' })
  meta?: string;

  @attribute({ type: 'Binary' })
  payload: string;

  @attribute({ type: 'String' })
  identifier?: string;

  @attribute({ type: 'String' })
  correlationId?: string; //uuid

  @attribute({ type: 'String' })
  causationId?: string; //uuid

  @rangeKey(DateType)
  created: Date;
}
