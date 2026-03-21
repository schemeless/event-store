/**
 * Simple async serial task executor.
 * Tasks within a partition are processed one at a time, in order.
 * Replaces RxQueue + createRxQueue (~200 lines) with ~40 lines.
 */
export class PartitionWorker {
  private queue: Array<{
    fn: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (reason: any) => void;
  }> = [];
  private running = false;
  private _paused = false;
  private _destroyed = false;

  constructor(public readonly id: string | number) {}

  /**
   * Enqueue a task and return a promise that resolves when the task completes.
   * Tasks are processed in FIFO order, one at a time.
   */
  async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    if (this._destroyed) {
      throw new Error(`PartitionWorker ${this.id} is destroyed`);
    }
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.pump();
    });
  }

  pause(): void {
    this._paused = true;
  }

  resume(): void {
    this._paused = false;
    this.pump();
  }

  /**
   * Returns a promise that resolves when all currently queued tasks are done.
   */
  async drain(): Promise<void> {
    if (this.queue.length === 0 && !this.running) return;
    return new Promise<void>((resolve) => {
      const check = () => {
        if (this.queue.length === 0 && !this.running) {
          resolve();
        } else {
          // Re-check after current task completes
          setTimeout(check, 1);
        }
      };
      check();
    });
  }

  destroy(): void {
    this._destroyed = true;
    // Reject any pending tasks
    for (const item of this.queue) {
      item.reject(new Error(`PartitionWorker ${this.id} destroyed`));
    }
    this.queue = [];
  }

  get pending(): number {
    return this.queue.length + (this.running ? 1 : 0);
  }

  private async pump(): Promise<void> {
    if (this.running || this._paused || this._destroyed) return;
    this.running = true;

    while (this.queue.length > 0 && !this._paused && !this._destroyed) {
      const item = this.queue.shift()!;
      try {
        const result = await item.fn();
        item.resolve(result);
      } catch (err) {
        item.reject(err);
      }
    }

    this.running = false;
  }
}
