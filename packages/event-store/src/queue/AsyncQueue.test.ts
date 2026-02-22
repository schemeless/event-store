import { AsyncQueue } from './RxQueue';
import delay from 'delay.ts';

describe('AsyncQueue', () => {
  it('processes tasks with concurrency 1 by default', async () => {
    const log: number[] = [];
    const queue = new AsyncQueue<number, void>(async (task, done) => {
      log.push(task);
      await delay(10);
      done();
    });

    queue.push(1);
    queue.push(2);
    queue.push(3);

    await new Promise<void>((resolve) => {
      queue.drained$.subscribe(() => resolve());
    });

    expect(log).toEqual([1, 2, 3]);
  });

  it('respects concurrency limit', async () => {
    let active = 0;
    let maxActive = 0;
    const queue = new AsyncQueue<number, void>(
      async (_, done) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await delay(20);
        active--;
        done();
      },
      { concurrent: 2 }
    );

    queue.push(1);
    queue.push(2);
    queue.push(3);
    queue.push(4);

    await new Promise<void>((resolve) => {
      queue.drained$.subscribe(() => resolve());
    });

    expect(maxActive).toBe(2);
  });

  it('handles FILO order', async () => {
    const log: number[] = [];
    // Concurrency 1 to ensure order is predictable
    const queue = new AsyncQueue<number, void>(
      async (task, done) => {
        log.push(task);
        await delay(5);
        done();
      },
      { concurrent: 1, filo: true }
    );

    // We need to push multiple tasks quickly so they are in the queue buffer
    queue.push(1); // Starts immediately
    queue.push(2); // Buffered
    queue.push(3); // Buffered

    await new Promise<void>((resolve) => {
      queue.drained$.subscribe(() => resolve());
    });

    // 1 started immediately. 2 and 3 were buffered.
    // In FILO, 3 (last in) is popped first after 1 finishes.
    expect(log).toEqual([1, 3, 2]);
  });

  it('pauses and resumes', async () => {
    const log: number[] = [];
    const queue = new AsyncQueue<number, void>(async (task, done) => {
      log.push(task);
      done();
    });

    queue.pause();
    queue.push(1);
    queue.push(2);

    await delay(30);
    expect(log).toEqual([]);

    queue.resume();
    await new Promise<void>((resolve) => {
      queue.drained$.subscribe(() => resolve());
    });

    expect(log).toEqual([1, 2]);
  });

  it('stops processing and clears tasks on destroy', async () => {
    const log: number[] = [];
    const queue = new AsyncQueue<number, void>(async (task, done) => {
      log.push(task);
      await delay(20);
      done();
    });

    queue.push(1);
    queue.push(2);
    queue.push(3);

    await delay(5); // Task 1 starts
    queue.destroy();

    await delay(40);
    expect(log).toEqual([1]); // 2 and 3 should have been cleared

    // Future pushes should error
    let pushErr: any;
    queue.push(4, (err) => {
      pushErr = err;
    });
    expect(pushErr?.message).toBe('Queue is destroyed');
  });

  it('emits taskFailed$ when processFn fails', async () => {
    const errorLog: any[] = [];
    const queue = new AsyncQueue<number, void>((task, done) => {
      if (task === 2) {
        done(new Error('Fail 2'));
        return;
      }
      done();
    });

    queue.taskFailed$.subscribe((err) => errorLog.push(err.message));

    queue.push(1);
    queue.push(2);
    queue.push(3);

    await new Promise<void>((resolve) => {
      queue.drained$.subscribe(() => resolve());
    });

    expect(errorLog).toEqual(['Fail 2']);
  });

  it('emits empty$ when queue becomes empty even if tasks are still active', async () => {
    let emptyEmittedAt = 0;
    let drainedEmittedAt = 0;

    const queue = new AsyncQueue<number, void>(
      async (task, done) => {
        await delay(50);
        done();
      },
      { concurrent: 1 }
    );

    queue.empty$.subscribe(() => {
      emptyEmittedAt = Date.now();
    });
    queue.drained$.subscribe(() => {
      drainedEmittedAt = Date.now();
    });

    queue.push(1);
    queue.push(2);

    await new Promise<void>((resolve) => {
      queue.drained$.subscribe(() => resolve());
    });

    expect(emptyEmittedAt).toBeLessThanOrEqual(drainedEmittedAt);
    expect(drainedEmittedAt - emptyEmittedAt).toBeGreaterThanOrEqual(40); // 1 is active, 2 is buffered. When 2 is popped, empty$ fires. Then 2 takes 50ms.
  }, 1000);

  it('drained$ resolves even if a task has a sync error in processFn', async () => {
    const log: number[] = [];
    const queue = new AsyncQueue<number, void>((task, done) => {
      if (task === 1) {
        throw new Error('Sync error');
      }
      log.push(task);
      done();
    });

    queue.push(1);
    queue.push(2);

    await new Promise<void>((resolve) => {
      queue.drained$.subscribe(() => resolve());
    });

    expect(log).toEqual([2]);
  });
});
