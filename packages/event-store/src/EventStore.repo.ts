import { Connection, getManager, Repository } from 'typeorm';
import { EventStoreEntity } from './EventStore.entity';
import { ConnectionOptions } from 'typeorm';
import { getConnection } from './util/getConnection';
import { CreatedEvent } from './EventStore.types';

const serialiseEvent = (event: EventStoreEntity): EventStoreEntity => {
  return Object.assign({}, event, { payload: JSON.parse(event.payload) });
};

export class EventStoreRepo {
  public repo: Repository<EventStoreEntity>;
  public conn: Connection;

  constructor(private connectionOptions: ConnectionOptions) {}

  async init() {
    if (!this.conn) {
      this.conn = await getConnection([EventStoreEntity], this.connectionOptions);
      this.repo = this.conn.getRepository<EventStoreEntity>(EventStoreEntity);
    }
  }

  async getAllEvents(page: number): Promise<EventStoreEntity[]> {
    await this.init();
    const take = 100;
    const skip = take * page;
    return await this.repo.find({
      order: {
        id: 'ASC'
      },
      take,
      skip
    });
  }

  async getCorrelationEvents(correlationId: string): Promise<EventStoreEntity[]> {
    const events = await this.repo.find({
      where: { correlationId }
    });
    return events.map(serialiseEvent);
  }

  async getCausationEvents(causationId: string): Promise<EventStoreEntity[]> {
    const events = await this.repo.find({
      where: { causationId }
    });
    return events.map(serialiseEvent);
  }

  createEventEntity = (event: CreatedEvent<any>): EventStoreEntity => {
    const newEventEntity = new EventStoreEntity();
    const { trackingId, domain, type, payload, created, correlationId, causationId, identifier } = event;

    Object.assign(newEventEntity, {
      trackingId,
      domain,
      type,
      identifier,
      correlationId,
      causationId,
      created
    });

    newEventEntity.payload = JSON.stringify(payload);

    return newEventEntity;
  };

  storeEvents = async (events: CreatedEvent<any>[]) => {
    await this.init();
    const allEventEntities = events.map(this.createEventEntity);
    await getManager(this.conn.name).transaction(async entityManager => {
      await allEventEntities.reduce<Promise<any>>(async (acc, currentEventEntity) => {
        if (acc) await acc;
        await entityManager.save(currentEventEntity);
      }, null);
    });
  };
}
