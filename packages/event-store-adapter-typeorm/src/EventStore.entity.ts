import type { IEventStoreEntity } from '@schemeless/event-store-types';
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class EventStoreEntity implements IEventStoreEntity {
  @PrimaryGeneratedColumn()
  readonly id: number;

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

  @Column('varchar', { length: 36 })
  trackingId: string; //uuid

  @Column('varchar', { nullable: true, length: 36 })
  correlationId?: string; //uuid

  @Column('varchar', { nullable: true, length: 36 })
  causationId?: string; //uuid

  @Column()
  readonly created: Date;
}
