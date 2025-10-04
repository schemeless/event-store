import * as Queue from 'react-native-better-queue';
import { ProcessFunction } from 'react-native-better-queue';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { logger } from '../util/logger';
import * as Rx from 'rxjs/operators';
import * as R from 'ramda';
import { scan } from 'ramda';

const makeEventQueueObservable = <TASK, RESULT, RETURN = [Queue<TASK, RESULT>]>(
  queue: Queue<TASK, RESULT>,
  queueEventType: Queue.QueueEvent,
  queueId = 'unnamed'
): Observable<RETURN> => {
  return new Observable<RETURN>((observer) => {
    queue.on(queueEventType, (...args) => {
      logger.debug(`Queue Event: ${queueId} - ${queueEventType}`);
      observer.next(args.length === 0 ? [queue] : ([queue, ...args] as any));
    });
  });
};

const makeFailedEventQueueObservable = <TASK, RESULT, RETURN = [Queue<TASK, RESULT>]>(
  queue: Queue<TASK, RESULT>
): Observable<RETURN> => {
  return new Observable<RETURN>((observer) => {
    queue.on('task_failed', (id, error) => {
      logger.warn('EventQueueObservable error');
      // logger.fatal('%o', error);
      observer.error(error);
    });
  });
};

const makeQueue = <TASK, RESULT>(
  fn: ProcessFunction<TASK, RESULT>,
  queueOptions: Omit<Queue.QueueOptions<TASK, RESULT>, 'process'>
) => new Queue<TASK, RESULT>(fn, queueOptions);

export type ApplyQueue = ReturnType<typeof createRxQueue>;

export const createRxQueue = <TASK = any, RESULT = TASK>(
  id: string,
  queueOptions?: Omit<Queue.QueueOptions<TASK, RESULT>, 'process'>
) => {
  const process$ = new Subject<{ task: TASK; done: Queue.ProcessFunctionCb<RESULT> }>();
  const callback: Queue.ProcessFunction<TASK, RESULT> = (task, done) => {
    process$.next({ task: task as any, done }); // todo fixme
  };

  const queueSizeInput$ = new Subject<number>();
  const queueSizeOutput$ = new BehaviorSubject<number | null>(null);

  queueSizeInput$.pipe(Rx.scan((acc, curr) => (acc || 0) + curr, null)).subscribe(queueSizeOutput$);

  const customPush = (task: any, cb?: (err: any, result: any) => void) => {
    queueSizeInput$.next(+1);
    queue
      .push(task, cb)
      .on('finish', () => {
        queueSizeInput$.next(-1);
      })
      .on('failed', () => {
        queueSizeInput$.next(-1);
      });
  };

  const queue = makeQueue<TASK, RESULT>(callback, Object.assign(queueOptions || {}, { id: id }));
  return {
    id,
    queueInstance: queue,
    push: customPush as typeof queue.push,
    process$,
    task$: process$.pipe(Rx.map(R.prop('task'))),
    done$: process$.pipe(Rx.map(R.prop('done'))),
    drained$: makeEventQueueObservable<TASK, RESULT>(queue, 'drain', id),
    empty$: makeEventQueueObservable<TASK, RESULT>(queue, 'empty', id),
    taskFailed$: makeFailedEventQueueObservable<TASK, RESULT>(queue),
    queueSize$: queueSizeOutput$,
  };
};
