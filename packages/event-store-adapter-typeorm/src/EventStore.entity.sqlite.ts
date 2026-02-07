import type { IEventStoreEntity } from '@schemeless/event-store-types';
import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity({ name: 'event_store_entity' })
@Index('IDX_stream_sequence', ['domain', 'identifier', 'sequence'], { unique: true })
export class EventStoreEntitySqliteSpecial implements IEventStoreEntity<any, any | undefined> {
  @PrimaryColumn('varchar', { length: 36 })
  id: string; //uuid

  @Column('varchar', { length: 15 })
  domain: string;

  @Column('varchar', { length: 32 })
  type: string;

  @Column('text', { nullable: true })
  meta?: string;

  @Column('text')
  payload: string;

  @Column('varchar', { nullable: true, length: 64 })
  identifier?: string;

  @Column('varchar', { nullable: true, length: 36 })
  correlationId?: string; //uuid

  @Column('varchar', { nullable: true, length: 36 })
  causationId?: string; //uuid

  @Column('int', { nullable: true })
  sequence?: number;

  @Column({ type: 'datetime', precision: 6 })
  readonly created: Date;
}
