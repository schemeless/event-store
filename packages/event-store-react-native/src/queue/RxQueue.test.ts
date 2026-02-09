import { createRxQueue } from './RxQueue';
import { of, zip } from 'rxjs';
import * as Rx from 'rxjs/operators';

describe('Rx Queue', () => {
  it('should run work on done and task', (cb) => {
    const rxQueue = createRxQueue<number>('test');
    zip(rxQueue.task$, rxQueue.done$).subscribe(([task, done]) => {
      done(null, task);
    });
    rxQueue.push(1, () => {
      cb();
    });
  });

  it('should allow push and down', (cb) => {
    const rxQueue = createRxQueue<string, string>('pushTest');
    const taskVal = 'taskVal';
    const resultVal = 'resultVal';
    rxQueue.process$.subscribe(({ task, done }) => {
      expect(task).toBe(taskVal);
      done(null, resultVal);
    });
    rxQueue.push(taskVal, (err, result) => {
      expect(err).toBeNull();
      expect(result).toBe(resultVal);
      cb();
    });
  });

  it('should receive drain ', (cb) => {
    const rxQueue = createRxQueue<string, string>('drainTest');
    rxQueue.process$.subscribe(({ task, done }) => {
      done();
    });

    rxQueue.push('1');
    rxQueue.push('2');
    rxQueue.push('3');

    rxQueue.drained$.subscribe(([queue]) => {
      expect(queue.getStats().total).toBe(3);
      cb();
    });
  });

  it('should receive empty ', (cb) => {
    const rxQueue = createRxQueue<string, string>('emptyTest');
    rxQueue.process$.subscribe(({ task, done }) => {
      done();
    });

    rxQueue.push('1');
    rxQueue.push('2');
    rxQueue.push('3');

    rxQueue.empty$.subscribe(([queue]) => {
      expect(queue.getStats().total).toBe(3);
      cb();
    });
  });

  it('should receive failed ', (cb) => {
    const rxQueue = createRxQueue<string, string>('failedTest');
    rxQueue.process$.subscribe(({ task, done }) => {
      done('failed');
    });

    rxQueue.push('1');
    rxQueue.push('2');
    rxQueue.push('3');

    rxQueue.taskFailed$
      .pipe(
        Rx.catchError((err, caught) => {
          expect(err).toBe('failed');
          return of('done');
        })
      )
      .subscribe((end) => {
        expect(end).toBe('done');
        cb();
      });
  });

  it('should be able to get queue size', async () => {
    const rxQueue = createRxQueue<string, string>('basicTest');

    rxQueue.process$.subscribe(({ task, done }) => {
      done();
    });

    let arr = [];
    rxQueue.queueSize$.subscribe((size) => {
      arr.push(size);
    });

    rxQueue.push('1');
    rxQueue.push('2');
    rxQueue.push('3');

    await rxQueue.drain();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(arr).toEqual([null, 1, 2, 3, 2, 1, 0]);
  });

  it('should support pause, drain, and destroy lifecycle', async () => {
    const rxQueue = createRxQueue<string, string>('lifecycleTest');
    const processed: string[] = [];

    rxQueue.process$.subscribe(({ task, done }) => {
      processed.push(task);
      done();
    });

    rxQueue.push('a');
    rxQueue.push('b');

    await new Promise((resolve) => setTimeout(resolve, 10));
    await rxQueue.drain();
    expect(processed).toContain('a');
    expect(processed).toContain('b');

    await rxQueue.destroy();
  });
});
