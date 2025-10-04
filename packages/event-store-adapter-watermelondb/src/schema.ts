import { tableSchema } from '@nozbe/watermelondb';

export const eventStoreSchema = tableSchema({
  name: 'events',
  columns: [
    { name: 'domain', type: 'string' },
    { name: 'type', type: 'string' },
    { name: 'payload', type: 'string' },
    { name: 'meta', type: 'string', isOptional: true },
    { name: 'identifier', type: 'string', isOptional: true },
    { name: 'correlation_id', type: 'string', isOptional: true },
    { name: 'causation_id', type: 'string', isOptional: true },
    { name: 'created', type: 'number' },
  ],
});
