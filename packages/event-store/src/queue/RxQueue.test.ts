import { createRxQueue } from './RxQueue';
import { of, zip } from 'rxjs';
import * as Rx from 'rxjs/operators';

describe('Rx Queue', () => {
  it('should run work on done and task', cb => {
    const rxQueue = createRxQueue<number>('test');
    zip(rxQueue.task$, rxQueue.done$).subscribe(([task, done]) => {
      done(null, task);
    });
    rxQueue.push(1, () => {
      cb();
    });
  });

  it('should allow push and down', cb => {
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

  it('should receive drain ', cb => {
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

  it('should receive empty ', cb => {
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

  it('should receive failed ', cb => {
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
      .subscribe(end => {
        expect(end).toBe('done');
        cb();
      });
  });
});
