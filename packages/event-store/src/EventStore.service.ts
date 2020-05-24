import { logger } from './util/logger';
import * as Redis from 'ioredis';
import * as uuid from 'uuid/v4';
import { Connection, ConnectionOptions, Repository } from 'typeorm';
import * as Rx from 'rxjs/operators';
import { zip } from 'rxjs';
import { registerEventFlowTypes } from './EventFlow.register';
import { EventQueue } from './queue/EventQueue';
import { logEvent } from './util/logEvent';
import { EventStoreRepo } from './EventStore.repo';
import { BaseEvent, BaseEventInput, CreatedEvent, EventFlow, EventFlowMap } from './EventStore.types';
import { EventStoreEntity } from './EventStore.entity';
import { applyEvent } from './EventOperators/applyEvent.operator';
import { defaultEventCreator, getEventFlow } from './util/helpers';
import { persistAppliedEvents } from './EventOperators/persistAppliedEvents.operator';
import { discardFailedEvent } from './EventOperators/discardFailedEvent.opeartor';

export class EventStoreService {
  private readonly eventFlowMap: EventFlowMap;
  private readonly eventQueue: EventQueue;
  private readonly eventStoreRepo: EventStoreRepo;
  private _isReady: boolean;

  constructor(
    private eventFlows: EventFlow<any>[],
    connectionOptions: ConnectionOptions,
    redisOptions: Redis.RedisOptions | string,
    readonly waitQueueNamePrefix = 'default',
    readonly applyQueueNamePrefix = 'default'
  ) {
    this._isReady = false;
    this.eventFlowMap = registerEventFlowTypes({}, eventFlows);
    if (process.env.NODE_ENV === 'test' && waitQueueNamePrefix === 'test' && applyQueueNamePrefix === 'test') {
      this.waitQueueNamePrefix = 'test:';
      this.applyQueueNamePrefix = 'test:' + uuid().substr(-4);
    }
    this.eventQueue = new EventQueue(this.waitQueueNamePrefix, this.applyQueueNamePrefix, {
      redis: redisOptions
    });
    this.eventStoreRepo = new EventStoreRepo(connectionOptions);
  }

  public async isReady() {
    if (this._isReady) return true;
    await this.eventQueue.waitQueue.isReady();
    await this.eventQueue.applyQueue.isReady();
    await this.eventStoreRepo.init();
    this.startQueue();
    await this.printStatus();
    this._isReady = true;
    return true;
  }

  private startQueue() {
    const { waitPackage, applyPackage, applyQueue, waitQueue } = this.eventQueue;
    waitPackage.job$.pipe(Rx.tap(job => applyQueue.add(job.data))).subscribe();

    const applyDrained$ = zip(
      applyPackage.job$.pipe(applyEvent(applyQueue, this.eventFlowMap)),
      applyPackage.done$
    ).pipe(
      Rx.tap(([res, done]) => done(res instanceof Error ? res : null)),
      Rx.map(([res, done]) => res),
      Rx.buffer(applyPackage.drained$),
      Rx.tap(res => {
        if (res instanceof Error) {
          logger.fatal('error, empty apply queue');
          applyQueue.empty();
        }
      })
    );

    zip(waitPackage.done$, applyDrained$)
      .pipe(persistAppliedEvents(this.eventFlowMap, this.eventStoreRepo))
      .subscribe();

    this.consumeFailedEvents();
  }

  private consumeFailedEvents() {
    const { waitPackage, applyPackage } = this.eventQueue;
    waitPackage.failed$.pipe(discardFailedEvent).subscribe();
    applyPackage.failed$.pipe(discardFailedEvent).subscribe();
  }

  private async printStatus() {
    const { applyQueue, waitQueue } = this.eventQueue;
    const waitCount = await waitQueue.getJobCounts();
    const applyCount = await applyQueue.getJobCounts();
    logger.info(`Wait Queue JobCount: ${JSON.stringify(waitCount)}`);
    logger.info(`Apply Queue JobCount: ${JSON.stringify(applyCount)}`);
  }

  async receiveEventInput(domain: string, type: string, baseEventInput: BaseEventInput<any>) {
    return this.receiveEvent({
      domain,
      type,
      ...baseEventInput
    });
  }

  async receiveEvent(baseEvent: BaseEvent<any>): Promise<CreatedEvent<any>> {
    const eventFlow = getEventFlow(this.eventFlowMap, baseEvent);

    if (!eventFlow) {
      logger.warn(`${baseEvent.domain}|${baseEvent.type} is not known event.`);
      return null;
    }

    const event = defaultEventCreator<any>(baseEvent);

    logEvent(baseEvent, '✨', 'received');
    const job = await this.eventQueue.waitQueue.add(event);
    await job.finished();
    logEvent(job.data, '🏁', 'finished');
    return event;
  }

  async getCorrelationEvents(correlationId: string): Promise<BaseEvent<any>[]> {
    return this.eventStoreRepo.getCorrelationEvents(correlationId);
  }

  async getCausationEvents(causationId: string): Promise<BaseEvent<any>[]> {
    return this.eventStoreRepo.getCausationEvents(causationId);
  }

  async replay() {
    let page = 0;
    logger.info('replay starting');
    while (true) {
      const events = await this.eventStoreRepo.getAllEvents(page);
      if (events.length > 0) {
        logger.info(`page, ${page}. replaying ${events.length}`);
        await events.reduce<Promise<any>>(async (acc, currentEvent) => {
          if (acc) await acc;
          const EventFlow = getEventFlow(this.eventFlowMap, currentEvent);
          currentEvent.payload = JSON.parse(currentEvent.payload);
          logEvent(currentEvent, '✅️️', 'Apply');
          if (EventFlow.executor) {
            await EventFlow.executor(currentEvent);
          }
        }, null);
        page++;
      } else {
        logger.info(`replay finished pages ${page}`);
        break;
      }
    }
  }

  async getDbConnection(): Promise<Connection> {
    if (!this.eventStoreRepo.conn) {
      await this.eventStoreRepo.init();
    }
    return this.eventStoreRepo.conn;
  }

  async getEventRepo(): Promise<Repository<EventStoreEntity>> {
    if (!this.eventStoreRepo.conn) {
      await this.eventStoreRepo.init();
    }
    return this.eventStoreRepo.repo;
  }
}
