import * as Queue from 'bull';
import * as Rx from 'rxjs/operators';
import { Observable, Subject } from 'rxjs';
import { Job } from 'bull';
import * as R from 'ramda';
import { logger } from '../util/logger';
import { CreatedEvent } from '../EventStore.types';

const createEventQueueProcessObservable = (
  queue: Queue.Queue<CreatedEvent<any>>
): Observable<{ job: Queue.Job<CreatedEvent<any>>; done: Queue.DoneCallback }> =>
  new Observable<{ job: Queue.Job<CreatedEvent<any>>; done: Queue.DoneCallback }>(observer => {
    queue.process((job, done) => {
      observer.next({ job, done });
    });
    queue.on('error', error => {
      logger.warn('EventQueueProcessObservable error');
      logger.fatal('%o', error);
      observer.error(error);
    });
  });

function createEventQueueObservable<T>(queue: Queue.Queue<CreatedEvent<any>>, queueEventType: string): Observable<T> {
  return new Observable<T>(observer => {
    queue.on(queueEventType, (...args) => {
      logger.debug(`Queue Event: ${queue.name} - ${queueEventType}`);
      observer.next(args.length === 0 ? [queue] : ([queue, ...args] as any));
    });
    queue.on('error', error => {
      logger.warn('EventQueueObservable error');
      logger.fatal('%o', error);
      observer.error(error);
    });
  });
}

export type EventQueueType = Queue.Queue<CreatedEvent<any>>;

interface EventQueuePackage {
  process$: Observable<{ job: Queue.Job<CreatedEvent<any>>; done: Queue.DoneCallback }>;
  job$: Observable<Queue.Job<CreatedEvent<any>>>;
  done$: Observable<Queue.DoneCallback>;
  drained$: Observable<[EventQueueType]>;
  paused$: Observable<[EventQueueType]>;
  resumed$: Observable<[EventQueueType]>;
  failed$: Observable<[EventQueueType, Job<CreatedEvent<any>>, Error]>;
}

const createEventQueueObservablePackage = (queue: EventQueueType): EventQueuePackage => {
  const process$ = createEventQueueProcessObservable(queue).pipe(Rx.share());
  return {
    process$,
    job$: process$.pipe(Rx.map(R.prop('job'))),
    done$: process$.pipe(Rx.map(R.prop('done'))),
    drained$: createEventQueueObservable(queue, 'drained'),
    failed$: createEventQueueObservable(queue, 'failed'),
    paused$: createEventQueueObservable(queue, 'paused'),
    resumed$: createEventQueueObservable(queue, 'resumed')
  };
};

export class EventQueue {
  readonly waitQueue: EventQueueType;
  readonly applyQueue: EventQueueType;

  readonly waitPackage: EventQueuePackage;
  readonly applyPackage: EventQueuePackage;

  constructor(
    waitQueueNamePrefix: string = 'default',
    applyQueueNamePrefix: string = 'default',
    opts?: Queue.QueueOptions
  ) {
    this.waitQueue = new Queue(waitQueueNamePrefix + ':wait', opts);
    this.applyQueue = new Queue(applyQueueNamePrefix + ':apply', Object.assign({}, opts, { lifo: true }));

    this.waitPackage = createEventQueueObservablePackage(this.waitQueue);
    this.applyPackage = createEventQueueObservablePackage(this.applyQueue);
  }
}
