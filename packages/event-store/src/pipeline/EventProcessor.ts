import type {
  AggregateEventObserver,
  BaseEvent,
  BaseEventInput,
  CreatedEvent,
  EventFlow,
  EventFlowMap,
  IEventStoreRepo,
  SuccessEventObserver,
} from '@schemeless/event-store-types';
import { PartitionWorker } from './PartitionWorker';
import { processEventTree, AggregateLoader, ProcessedEvent, EventTreeProcessError, ProcessResult } from './processEventTree';
import { runSideEffects } from './SideEffectRunner';
import { runObservers, ProcessedEventWithState } from './ObserverRunner';
import { registerEventFlowTypes } from '../operators/registerEventFlowTypes';
import { getPartitionIndex } from '../queue/shardUtils';
import { logEvent } from '../util/logEvent';
import type { EventOutput } from '../EventStore.types';

export interface EventProcessorOptions {
  mainConcurrency?: number;
  sideEffectConcurrency?: number;
  maxEventDepth?: number;
}

export class EventProcessor {
  private partitions: PartitionWorker[];
  private sideEffectPartitions: PartitionWorker[];
  private eventFlowMap: EventFlowMap;
  private eventHandlers: Array<(output: EventOutput) => void> = [];
  private _shutdown = false;

  constructor(
    private repo: IEventStoreRepo,
    eventFlows: EventFlow[],
    private observers: Array<SuccessEventObserver<any> | AggregateEventObserver<any, any>>,
    private getAggregate: AggregateLoader | undefined,
    private options: EventProcessorOptions = {}
  ) {
    const { mainConcurrency = 1, sideEffectConcurrency = 1 } = options;

    this.eventFlowMap = registerEventFlowTypes({}, eventFlows);

    this.partitions = Array.from(
      { length: mainConcurrency },
      (_, i) => new PartitionWorker(`main-${i}`)
    );

    this.sideEffectPartitions = Array.from(
      { length: sideEffectConcurrency },
      (_, i) => new PartitionWorker(`sideEffect-${i}`)
    );
  }

  /**
   * Submit an event for full processing:
   * 1. Route to partition (by shard key)
   * 2. Process event tree (validate → apply → consequent events)
   * 3. Persist all events
   * 4. Run side effects (may cascade new events)
   * 5. Run observers
   */
  async submit(
    flow: EventFlow,
    input: BaseEventInput<any>
  ): Promise<[CreatedEvent<any>, ...Array<CreatedEvent<any>>]> {
    if (this._shutdown) {
      throw new Error('EventProcessor is shut down');
    }

    const event: BaseEvent<any> = {
      ...input,
      domain: flow.domain,
      type: flow.type,
      created: input.created || undefined,
      meta: {
        ...(input.meta || {}),
        schemaVersion: flow.schemaVersion || 1,
      },
    };

    const partition = this.getPartition(event);
    const worker = this.partitions[partition];

    return worker.enqueue(async () => {
      let result: ProcessResult | undefined;
      const createdEvents: CreatedEvent<any>[] = [];

      try {
        // 1. Process event tree
        result = await processEventTree(
          event,
          this.eventFlowMap,
          this.getAggregate,
          { maxDepth: this.options.maxEventDepth }
        );

        createdEvents.push(...result.events.map((p) => p.event));

        // 2. Persist
        await this.repo.storeEvents(createdEvents);

        // 3. Notify success
        this.notifyHandlers(createdEvents, 'success');

        // 4. Side effects (in side effect partition for ordering)
        this.runSideEffectsInPartition(createdEvents);

        // 5. Observers
        const eventsWithState: ProcessedEventWithState[] = result.events.map((p) => ({
          event: p.event,
          aggregateState: p.aggregateState,
        }));
        await runObservers(eventsWithState, this.observers);

        return createdEvents as [CreatedEvent<any>, ...Array<CreatedEvent<any>>];
      } catch (err) {
        // On failure, cancel applied events
        if (err instanceof EventTreeProcessError) {
          await this.cancelAppliedEvents(err.appliedEvents);
          this.notifyHandlers(createdEvents, 'error');
          throw err.originalError;
        } else if (result) {
          await this.cancelAppliedEvents(result.events);
        }
        this.notifyHandlers(createdEvents, 'error');
        throw err;
      }
    });
  }

  /**
   * Push a raw BaseEvent (used internally by side effects).
   */
  async pushRaw(event: BaseEvent<any>): Promise<void> {
    const partition = this.getPartition(event);
    const worker = this.partitions[partition];

    await worker.enqueue(async () => {
      let result: ProcessResult | undefined;
      const createdEvents: CreatedEvent<any>[] = [];
      try {
        result = await processEventTree(
          event,
          this.eventFlowMap,
          this.getAggregate,
          { maxDepth: this.options.maxEventDepth }
        );

        createdEvents.push(...result.events.map((p) => p.event));
        await this.repo.storeEvents(createdEvents);
        this.notifyHandlers(createdEvents, 'success');

        this.runSideEffectsInPartition(createdEvents);

        const eventsWithState: ProcessedEventWithState[] = result.events.map((p) => ({
          event: p.event,
          aggregateState: p.aggregateState,
        }));
        await runObservers(eventsWithState, this.observers);
      } catch (err) {
        if (err instanceof EventTreeProcessError) {
          await this.cancelAppliedEvents(err.appliedEvents);
          this.notifyHandlers(createdEvents, 'error');
          throw err.originalError;
        } else if (result) {
          await this.cancelAppliedEvents(result.events);
        }
        this.notifyHandlers(createdEvents, 'error');
        throw err;
      }
    });
  }

  onProcessed(handler: (output: EventOutput) => void): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const idx = this.eventHandlers.indexOf(handler);
      if (idx !== -1) this.eventHandlers.splice(idx, 1);
    };
  }

  async shutdown(timeout = 5000): Promise<void> {
    this._shutdown = true;

    const drainPromise = (async () => {
      // Drain all partitions
      await Promise.all(this.partitions.map((p) => p.drain()));
      await Promise.all(this.sideEffectPartitions.map((p) => p.drain()));

      // Destroy all workers
      for (const p of [...this.partitions, ...this.sideEffectPartitions]) {
        p.destroy();
      }

      // Close repo if it supports it
      if (this.repo.close) {
        await this.repo.close();
      }
    })();

    let timer: any;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Shutdown timeout after ${timeout}ms`)), timeout);
      timer?.unref?.();
    });

    try {
      await Promise.race([drainPromise, timeoutPromise]);
    } finally {
      clearTimeout(timer);
    }
  }

  // --- Private ---

  private getPartition(event: BaseEvent<any>): number {
    const flow = this.eventFlowMap[`${event.domain}__${event.type}`];
    const key = flow?.getShardKey?.(event) ?? event.identifier ?? '';
    if (!key) return 0;
    return getPartitionIndex(key, this.partitions.length);
  }

  private runSideEffectsInPartition(events: CreatedEvent<any>[]): void {
    if (events.length === 0) return;
    const worker = this.sideEffectPartitions[this.getPartition(events[0]) % this.sideEffectPartitions.length];

    worker.enqueue(async () => {
      const results = await runSideEffects(events, this.eventFlowMap);

      for (const result of results) {
        for (const newEvent of result.newEvents) {
          // Cascade: new events from side effects go through the full pipeline
          await this.pushRaw(newEvent);
        }
      }
    }).catch((e) => {
      // logger.error('Unhandled error in side effect partition', e);
    });
  }

  private async cancelAppliedEvents(processed: ProcessedEvent[]): Promise<void> {
    for (const { event } of processed) {
      try {
        const flow = this.eventFlowMap[`${event.domain}__${event.type}`];
        if (flow?.cancelApply) {
          await flow.cancelApply(event);
        }
      } catch (e) {
        // Best-effort cancel
      }
    }
  }

  private notifyHandlers(events: CreatedEvent<any>[], status: 'success' | 'error'): void {
    for (const event of events) {
      const output: EventOutput = {
        event,
        state: status === 'success' ? 'Event:success' as any : 'Event:invalid' as any,
      };
      for (const handler of this.eventHandlers) {
        try { handler(output); } catch (e) { /* ignore handler errors */ }
      }
    }
  }
}
