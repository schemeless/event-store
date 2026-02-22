import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { logger } from '../util/logger';
import * as Rx from 'rxjs/operators';
import * as R from 'ramda';

export interface QueueOptions {
  id?: string;
  concurrent?: number;
  filo?: boolean;
}

export type ProcessFunctionCb<T> = (error?: any, result?: T) => void;
export type ProcessFunction<TASK, RESULT> = (task: TASK, cb: ProcessFunctionCb<RESULT>) => void;

export class AsyncQueue<TASK, RESULT> {
  private tasks: { task: TASK; cb?: (err: any, result: any) => void }[] = [];
  private activeCount = 0;
  private isPaused = false;
  private isDestroyed = false;

  public readonly drained$ = new Subject<[AsyncQueue<TASK, RESULT>]>();
  public readonly empty$ = new Subject<[AsyncQueue<TASK, RESULT>]>();
  public readonly taskFailed$ = new Subject<any>();

  constructor(private processFn: ProcessFunction<TASK, RESULT>, private options: QueueOptions = {}) {}

  public push(task: TASK, cb?: (err: any, result: any) => void) {
    if (this.isDestroyed) {
      const err = new Error('Queue is destroyed');
      if (cb) cb(err, undefined);
      return this;
    }

    this.tasks.push({ task, cb });
    Promise.resolve().then(() => this.pump());

    return this;
  }

  public pause() {
    this.isPaused = true;
  }

  public resume() {
    this.isPaused = false;
    Promise.resolve().then(() => this.pump());
  }

  public destroy(cb?: () => void) {
    this.isDestroyed = true;
    this.tasks = [];
    if (cb) cb();
  }

  private pump() {
    if (this.isPaused || this.isDestroyed) return;

    const concurrent = this.options.concurrent || 1;
    while (this.activeCount < concurrent && this.tasks.length > 0) {
      const item = this.options.filo ? this.tasks.pop() : this.tasks.shift();
      if (!item) break;

      this.activeCount++;
      const { task, cb } = item;

      if (this.tasks.length === 0) {
        // Defer to next microtask so Observable pipelines settle before drain/empty is observed
        Promise.resolve().then(() => this.empty$.next([this]));
      }

      try {
        this.processFn(task, (err, result) => {
          this.activeCount--;
          if (err) {
            this.taskFailed$.next(err);
            if (cb) cb(err, undefined);
          } else {
            if (cb) cb(null, result);
          }

          Promise.resolve().then(() => {
            if (this.activeCount === 0 && this.tasks.length === 0) {
              this.drained$.next([this]);
            }
            this.pump();
          });
        });
      } catch (err) {
        this.activeCount--;
        this.taskFailed$.next(err);
        if (cb) cb(err, undefined);

        Promise.resolve().then(() => {
          if (this.activeCount === 0 && this.tasks.length === 0) {
            this.drained$.next([this]);
          }
          this.pump();
        });
      }
    }
  }
}

export type ApplyQueue = ReturnType<typeof createRxQueue>;

export const createRxQueue = <TASK = any, RESULT = TASK>(id: string, queueOptions?: QueueOptions) => {
  let pendingTasks = 0;
  const pendingDrainResolvers: Array<() => void> = [];
  // Emitted (deferred one microtask) when pendingTasks drops to 0
  const drained$ = new Subject<null>();

  const resolvePendingDrainersIfIdle = () => {
    if (pendingTasks !== 0) return;
    while (pendingDrainResolvers.length > 0) {
      const resolve = pendingDrainResolvers.shift();
      resolve?.();
    }
  };

  const emitDrainedIfIdle = () => {
    // Defer Observable emission by two microtasks so RxJS Promise-based operators
    // (mergeMap(async), scan, combineLatest, etc.) have time to flush final values
    // before drained$ observers consume the idle signal.
    Promise.resolve().then(() => {
      Promise.resolve().then(() => {
        if (pendingTasks === 0) {
          drained$.next(null);
        }
      });
    });
  };

  const process$ = new Subject<{ task: TASK; done: ProcessFunctionCb<RESULT> }>();
  const callback: ProcessFunction<TASK, RESULT> = (task, done) => {
    process$.next({ task, done });
  };

  const queueSizeInput$ = new Subject<number>();
  const queueSizeOutput$ = new BehaviorSubject<number | null>(null);

  queueSizeInput$.pipe(Rx.scan((acc, curr) => (acc || 0) + curr, null)).subscribe(queueSizeOutput$);

  const queue = new AsyncQueue<TASK, RESULT>(callback, Object.assign(queueOptions || {}, { id }));

  const taskFailed$ = new Observable<any>((observer) => {
    const sub = queue.taskFailed$.subscribe({
      next: (error) => {
        logger.warn('EventQueueObservable error');
        observer.error(error);
      },
    });
    return () => sub.unsubscribe();
  });

  const customPush = (task: any, cb?: (err: any, result: any) => void) => {
    pendingTasks += 1;
    queueSizeInput$.next(+1);
    queue.push(task, (err, result) => {
      pendingTasks = Math.max(0, pendingTasks - 1);
      queueSizeInput$.next(-1);
      resolvePendingDrainersIfIdle();
      if (cb) cb(err, result);
      // Defer Observable drained$ emission so the RxJS pipeline (scan, combineLatest etc.)
      // has time to process the result before drained$ subscribers are notified.
      emitDrainedIfIdle();
    });
  };

  return {
    id,
    queueInstance: queue,
    // Provide correct type bound via assertion
    push: customPush as (task: TASK, cb?: ProcessFunctionCb<RESULT>) => void,
    process$,
    task$: process$.pipe(Rx.map(R.prop('task'))),
    done$: process$.pipe(Rx.map(R.prop('done'))),
    drained$: drained$.asObservable(),
    empty$: queue.empty$.asObservable(),
    taskFailed$: taskFailed$,
    queueSize$: queueSizeOutput$,
    // Lifecycle methods for graceful shutdown
    pause: (): void => queue.pause(),
    resume: (): void => queue.resume(),
    drain: (): Promise<void> => {
      if (pendingTasks === 0) {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        pendingDrainResolvers.push(() => {
          resolve();
        });
      });
    },
    destroy: (): Promise<void> => new Promise((resolve) => queue.destroy(() => resolve())),
  };
};
