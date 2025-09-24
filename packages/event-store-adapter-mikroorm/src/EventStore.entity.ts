import type { IEventStoreEntity } from '@schemeless/event-store-types';
import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

@Entity({ tableName: 'event_store_entity' })
export class EventStoreEntity implements IEventStoreEntity<any, any | undefined> {
  @PrimaryKey({ type: 'string', length: 36 })
  id!: string;

  @Property({ type: 'string', length: 15 })
  domain!: string;

  @Property({ type: 'string', length: 32 })
  type!: string;

  @Property({ type: 'text', nullable: true })
  meta?: string | null;

  @Property({ type: 'text' })
  payload!: string;

  @Property({ type: 'string', length: 64, nullable: true })
  identifier?: string | null;

  @Property({ type: 'string', length: 36, nullable: true })
  correlationId?: string | null;

  @Property({ type: 'string', length: 36, nullable: true })
  causationId?: string | null;

  @Property()
  readonly created!: Date;
}
