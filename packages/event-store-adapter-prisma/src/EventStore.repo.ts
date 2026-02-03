import type { CreatedEvent, IEventStoreEntity, IEventStoreRepo } from '@schemeless/event-store-types';
import type { Prisma, PrismaClient } from '@prisma/client';
import { EventStoreIterator } from './EventStoreIterator';

const serializePayload = (payload: unknown): string => JSON.stringify(payload ?? null);
const serializeMeta = (meta: unknown): string | null | undefined => {
  if (meta === undefined) {
    return undefined;
  }

  return meta === null ? null : JSON.stringify(meta);
};

type PrismaEventStoreEntityCreateInput = Omit<Prisma.EventStoreEntityCreateInput, 'created'> & {
  created: Date;
};

type PrismaEventStoreEntity = PrismaEventStoreEntityCreateInput & IEventStoreEntity<any, any>;

export class EventStoreRepo implements IEventStoreRepo {
  constructor(private readonly prisma: PrismaClient) {}

  async init(): Promise<void> {
    await this.prisma.$connect();
  }

  async getAllEvents(
    pageSize: number = 100,
    startFromId?: string
  ): Promise<AsyncIterableIterator<IEventStoreEntity[]>> {
    return new EventStoreIterator(this.prisma, pageSize, startFromId);
  }

  createEventEntity(event: CreatedEvent<any>): PrismaEventStoreEntity {
    const { id, domain, type, payload, meta, created, correlationId, causationId, identifier } = event;

    const entity: PrismaEventStoreEntity = {
      id,
      domain,
      type,
      created,
      payload: serializePayload(payload),
      identifier: identifier ?? null,
      correlationId: correlationId ?? null,
      causationId: causationId ?? null,
    };

    const serializedMeta = serializeMeta(meta);
    if (serializedMeta !== undefined) {
      entity.meta = serializedMeta;
    }

    return entity;
  }

  async storeEvents(events: CreatedEvent<any>[]): Promise<void> {
    if (!events.length) {
      return;
    }

    const dataToCreate = events.map((event) => this.createEventEntity(event));

    await this.prisma.$transaction(async (tx) => {
      for (const data of dataToCreate) {
        await tx.eventStoreEntity.create({ data });
      }
    });
  }

  async resetStore(): Promise<void> {
    await this.prisma.eventStoreEntity.deleteMany({});
  }

  async getEventById(id: string): Promise<IEventStoreEntity | null> {
    const entity = await this.prisma.eventStoreEntity.findUnique({
      where: { id },
    });
    if (!entity) {
      return null;
    }
    return {
      id: entity.id,
      domain: entity.domain,
      type: entity.type,
      identifier: entity.identifier ?? undefined,
      correlationId: entity.correlationId ?? undefined,
      causationId: entity.causationId ?? undefined,
      created: entity.created,
      payload: JSON.parse(entity.payload),
      meta: entity.meta != null ? JSON.parse(entity.meta) : undefined,
    };
  }

  async findByCausationId(causationId: string): Promise<IEventStoreEntity[]> {
    const entities = await this.prisma.eventStoreEntity.findMany({
      where: { causationId },
      orderBy: [{ created: 'asc' }, { id: 'asc' }],
    });
    return entities.map((entity) => ({
      id: entity.id,
      domain: entity.domain,
      type: entity.type,
      identifier: entity.identifier ?? undefined,
      correlationId: entity.correlationId ?? undefined,
      causationId: entity.causationId ?? undefined,
      created: entity.created,
      payload: JSON.parse(entity.payload),
      meta: entity.meta != null ? JSON.parse(entity.meta) : undefined,
    }));
  }
}
