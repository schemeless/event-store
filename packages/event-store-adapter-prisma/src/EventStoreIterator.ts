import type { PrismaClient } from '@prisma/client';
import type { IEventStoreEntity } from '@schemeless/event-store-types';

type PrismaFindManyResult = ReturnType<PrismaClient['eventStoreEntity']['findMany']>;
type PrismaEventStoreEntityArray = PrismaFindManyResult extends Promise<infer U> ? U : never;
type PrismaEventStoreEntity = PrismaEventStoreEntityArray extends Array<infer U> ? U : never;

const deserializeEvent = (entity: PrismaEventStoreEntity): IEventStoreEntity<any, any> => ({
  id: entity.id,
  domain: entity.domain,
  type: entity.type,
  identifier: entity.identifier ?? undefined,
  correlationId: entity.correlationId ?? undefined,
  causationId: entity.causationId ?? undefined,
  created: entity.created,
  payload: JSON.parse(entity.payload),
  meta: entity.meta != null ? JSON.parse(entity.meta) : undefined,
});

export class EventStoreIterator implements AsyncIterableIterator<IEventStoreEntity[]> {
  private currentPage = 0;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly pageSize: number,
    private readonly startFromId?: string
  ) {}

  async next(): Promise<IteratorResult<IEventStoreEntity[]>> {
    const results = await this.prisma.eventStoreEntity.findMany({
      take: this.pageSize,
      skip: this.pageSize * this.currentPage,
      orderBy: [{ created: 'asc' }, { id: 'asc' }],
      where: this.startFromId
        ? {
            id: {
              gt: this.startFromId,
            },
          }
        : undefined,
    });

    this.currentPage += 1;

    if (!results.length) {
      return { done: true, value: undefined };
    }

    return { done: false, value: results.map(deserializeEvent) };
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<IEventStoreEntity[]> {
    return this;
  }
}
