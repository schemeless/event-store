import { PartitionWorker } from './PartitionWorker';

describe('PartitionWorker', () => {
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it('serial execution: tasks complete in order', async () => {
    const worker = new PartitionWorker('test-serial');
    const order: number[] = [];

    const task1 = worker.enqueue(async () => {
      await delay(20);
      order.push(1);
    });
    const task2 = worker.enqueue(async () => {
      await delay(10);
      order.push(2);
    });

    await Promise.all([task1, task2]);

    expect(order).toEqual([1, 2]);
  });

  it('concurrent enqueue: multiple callers, still serial', async () => {
    const worker = new PartitionWorker('test-concurrent');
    const order: number[] = [];

    await Promise.all([
      worker.enqueue(async () => {
        await delay(20);
        order.push(1);
      }),
      worker.enqueue(async () => {
        await delay(10);
        order.push(2);
      }),
      worker.enqueue(async () => {
        await delay(5);
        order.push(3);
      }),
    ]);

    expect(order).toEqual([1, 2, 3]);
  });

  it('pause/resume: delays execution until resumed', async () => {
    const worker = new PartitionWorker('test-pause');
    const order: number[] = [];

    worker.pause();

    const task1 = worker.enqueue(async () => {
      order.push(1);
    });

    expect(order).toEqual([]); // Still paused
    await delay(10);
    expect(order).toEqual([]);

    worker.resume();
    await task1;
    expect(order).toEqual([1]);
  });

  it('drain waits for all tasks', async () => {
    const worker = new PartitionWorker('test-drain');
    let task1Done = false;
    let task2Done = false;

    worker.enqueue(async () => {
      await delay(10);
      task1Done = true;
    });

    worker.enqueue(async () => {
      await delay(20);
      task2Done = true;
    });

    await worker.drain();

    expect(task1Done).toBe(true);
    expect(task2Done).toBe(true);
  });

  it('destroy rejects pending tasks', async () => {
    const worker = new PartitionWorker('test-destroy');
    let task1Finished = false;

    worker.enqueue(async () => {
      await delay(20);
      task1Finished = true;
    });

    const task2 = worker.enqueue(async () => {
      return 2;
    });
    const task3 = worker.enqueue(async () => {
      return 3;
    });

    worker.destroy();

    await expect(task2).rejects.toThrow('PartitionWorker test-destroy destroyed');
    await expect(task3).rejects.toThrow('PartitionWorker test-destroy destroyed');

    // Wait for task1 to potentially finish to see if it causes issues, 
    // but the destroy should prevent next tick.
    await delay(30);
    expect(task1Finished).toBe(true); // task1 should finish because it started before destroy
  });

  it('error in one task does not break subsequent tasks', async () => {
    const worker = new PartitionWorker('test-error');

    const task1 = worker.enqueue(async () => {
      throw new Error('Task 1 failed');
    });

    const task2 = worker.enqueue(async () => {
      return 'Task 2 success';
    });

    await expect(task1).rejects.toThrow('Task 1 failed');
    await expect(task2).resolves.toBe('Task 2 success');
  });
});
