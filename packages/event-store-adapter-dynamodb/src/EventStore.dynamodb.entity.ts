import type { IEventStoreEntity } from '@schemeless/event-store-types';

export const TIME_BUCKET_INDEX = 'timeBucketIndex';
export const CAUSATION_INDEX = 'causationIndex';

export interface DynamoDBIndexOptions {
  type: 'global';
  projection: 'keys' | 'all' | 'include';
  readCapacityUnits: number;
  writeCapacityUnits: number;
}

export const dateIndexGSIOptions: DynamoDBIndexOptions = {
  type: 'global',
  projection: 'keys',
  readCapacityUnits: 10,
  writeCapacityUnits: 5,
};

export class EventStoreEntity implements IEventStoreEntity<any, any> {
  id: string;
  domain: string;
  type: string;
  meta?: string;
  payload: any;
  s3Reference?: string;
  identifier?: string;
  correlationId?: string;
  causationId?: string;
  timeBucket: string;
  created: Date;

  static fromItem(item: any): EventStoreEntity {
    const entity = new EventStoreEntity();
    Object.assign(entity, item);
    if (item.id) {
      entity.id = item.id.replace(/^EventID#/, '');
    }
    if (item.payload && typeof item.payload === 'string') {
      try {
        entity.payload = JSON.parse(item.payload);
      } catch (e) {
        // ignore
      }
    }
    if (item.created) {
      entity.created = new Date(item.created);
    }
    return entity;
  }

  toItem(): any {
    return {
      ...this,
      id: `EventID#${this.id}`,
      payload: this.payload ? JSON.stringify(this.payload) : undefined,
      created: this.created ? this.created.toISOString() : undefined,
    };
  }

  // Helper to generate bucket ID
  generateTimeBucket() {
    // Bucket by Month to reduce partition count for global replay
    // Format: YYYY-MM
    if (this.created) {
      this.timeBucket = this.created.toISOString().slice(0, 7);
    }
  }
}
