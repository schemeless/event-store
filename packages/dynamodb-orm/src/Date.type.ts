import { CustomType } from '@aws/dynamodb-data-marshaller';
import { AttributeValue } from 'aws-sdk/clients/dynamodb';

export const DateType: CustomType<Date> = {
  type: 'Custom',
  attributeType: 'S',
  marshall: (input: Date): AttributeValue => ({ S: input.toISOString() }),
  unmarshall: (persistedValue: AttributeValue): Date => new Date(persistedValue.S!),
};
