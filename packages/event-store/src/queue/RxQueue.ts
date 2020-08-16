import * as Queue from 'better-queue';
import { ProcessFunction } from 'better-queue';
import { Observable, Subject } from 'rxjs';
import { logger } from '../util/logger';
import * as Rx from 'rxjs/operators';
import * as R from 'ramda';

function createEventQueueObservable<TASK, RESULT, RETURN = [Queue<TASK, RESULT>]>(
  queue: Queue<TASK, RESULT>,
  queueEventType: Queue.QueueEvent,
  queueName = 'unnamed'
): Observable<RETURN> {
  return new Observable<RETURN>(observer => {
    queue.on(queueEventType, (...args) => {
      logger.debug(`Queue Event: ${queueName} - ${queueEventType}`);
      observer.next(args.length === 0 ? [queue] : ([queue, ...args] as any));
    });
    queue.on('error', error => {
      logger.warn('EventQueueObservable error');
      logger.fatal('%o', error);
      observer.error(error);
    });
  });
}

const makeQueue = <TASK, RESULT>(
  fn: ProcessFunction<TASK, RESULT>,
  queueOptions: Omit<Queue.QueueOptions<TASK, RESULT>, 'process'>
) => new Queue<TASK, RESULT>(fn, queueOptions);

export type ApplyQueue = ReturnType<typeof createRxQueue>;

export const createRxQueue = <TASK = any, RESULT = TASK>(
  name: string,
  queueOptions?: Omit<Queue.QueueOptions<TASK, RESULT>, 'process'>
) => {
  const process$ = new Subject<{ task: TASK; done: Queue.ProcessFunctionCb<RESULT> }>();
  const callback: Queue.ProcessFunction<TASK, RESULT> = (task, done) => {
    process$.next({ task, done });
  };
  const queue = makeQueue<TASK, RESULT>(callback, queueOptions);
  return {
    name: name,
    queueInstance: queue,
    push: ((task, cb): Queue.Ticket => queue.push(task, cb)) as typeof queue.push,
    process$,
    task$: process$.pipe(Rx.map(R.prop('task'))),
    done$: process$.pipe(Rx.map(R.prop('done'))),
    drained$: createEventQueueObservable<TASK, RESULT>(queue, 'drain', name),
    empty$: createEventQueueObservable<TASK, RESULT>(queue, 'empty', name),
    taskFailed$: createEventQueueObservable<TASK, RESULT, [Queue<TASK, RESULT>, string, { error: Error; task: TASK }]>(
      queue,
      'task_failed',
      name
    )
  };
};
