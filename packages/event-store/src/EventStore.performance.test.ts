import { getTestEventStore, shutdownEventStore } from './util/testHelpers';
import { BaseEvent, CreatedEvent, EventFlow, SuccessEventObserver } from '@schemeless/event-store-types';
import delay from 'delay.ts';
import { getPartitionIndex } from './queue/shardUtils';

jest.setTimeout(20_000);

const findKeysForAllPartitions = (numPartitions: number): string[] => {
  const keys = Array.from({ length: numPartitions }, () => '');

  for (let i = 0; i < 50_000 && keys.some((key) => key === ''); i += 1) {
    const key = `partition-key-${i}`;
    const partition = getPartitionIndex(key, numPartitions);
    if (keys[partition] === '') {
      keys[partition] = key;
    }
  }

  if (keys.some((key) => key === '')) {
    throw new Error(`Failed to find keys for all ${numPartitions} partitions`);
  }

  return keys;
};

const createInFlightProbe = (total: number) => {
  let inFlight = 0;
  let maxInFlight = 0;
  let completed = 0;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  return {
    enter() {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
    },
    leave() {
      inFlight -= 1;
      completed += 1;
      if (completed === total) {
        resolveDone();
      }
    },
    done,
    getMaxInFlight() {
      return maxInFlight;
    },
  };
};

const withReceive = <Payload>(flowWithoutReceive: Omit<EventFlow<Payload>, 'receive'>): EventFlow<Payload> => {
  const flow = flowWithoutReceive as EventFlow<Payload>;
  (flow as any).receive = (eventStore: any) => (eventInputArgs: any) => eventStore.receive(flow)(eventInputArgs);
  return flow;
};

describe('EventStore Extended Performance Verification', () => {
  afterEach(async () => {
    await shutdownEventStore();
  });

  describe('1. Concurrency Behavior', () => {
    it('mainQueue does not block across shards when concurrent > 1', async () => {
      const executionLog: string[] = [];

      const slowFlow: EventFlow<{ id: string }> = withReceive({
        domain: 'main_perf',
        type: 'slow',
        samplePayload: { id: 'a' },
        getShardKey: () => 'shard-A',
        apply: async () => {
          executionLog.push('start-A');
          await delay(200);
          executionLog.push('end-A');
        },
      });

      const fastFlow: EventFlow<{ id: string }> = withReceive({
        domain: 'main_perf',
        type: 'fast',
        samplePayload: { id: 'b' },
        getShardKey: () => 'shard-B',
        apply: async () => {
          await delay(50);
          executionLog.push('start-B');
          await delay(10);
          executionLog.push('end-B');
        },
      });

      const store = await getTestEventStore([slowFlow, fastFlow], [], { mainQueueConcurrent: 2 });

      await Promise.all([
        store.receive(slowFlow)({ payload: { id: '1' } }),
        store.receive(fastFlow)({ payload: { id: '2' } }),
      ]);
      await store.mainQueue.drain();

      const startBIndex = executionLog.indexOf('start-B');
      const endAIndex = executionLog.indexOf('end-A');
      const endBIndex = executionLog.indexOf('end-B');

      expect(startBIndex).toBeLessThan(endAIndex);
      expect(endBIndex).toBeLessThan(endAIndex);
    });

    it('observerQueue concurrency changes max in-flight observer executions', async () => {
      const delayMs = 80;
      const childCount = 8;
      const domain = 'obs_perf';

      const childFlow: EventFlow<{ key: string }> = withReceive({
        domain,
        type: 'child',
        samplePayload: { key: 'x' },
        apply: async () => undefined,
      });

      const rootFlow: EventFlow<{ batch: string }> = withReceive({
        domain,
        type: 'root',
        samplePayload: { batch: 'b' },
        createConsequentEvents: () =>
          Array.from({ length: childCount }, (_, index): BaseEvent<{ key: string }> => ({
            domain,
            type: 'child',
            payload: { key: `child-${index}` },
          })),
        apply: async () => undefined,
      });

      const makeObserver = (probe: ReturnType<typeof createInFlightProbe>): SuccessEventObserver<any> => ({
        filters: [{ domain, type: 'child' }],
        priority: 1,
        apply: async () => {
          probe.enter();
          try {
            await delay(delayMs);
          } finally {
            probe.leave();
          }
        },
      });

      const seqProbe = createInFlightProbe(childCount);
      const seqStore = await getTestEventStore([rootFlow, childFlow], [makeObserver(seqProbe)], {
        observerQueueConcurrent: 1,
      });
      await seqStore.receive(rootFlow)({ payload: { batch: 'seq' } });
      await seqProbe.done;
      expect(seqProbe.getMaxInFlight()).toBe(1);
      await shutdownEventStore();

      const parProbe = createInFlightProbe(childCount);
      const parStore = await getTestEventStore([rootFlow, childFlow], [makeObserver(parProbe)], {
        observerQueueConcurrent: 4,
      });
      await parStore.receive(rootFlow)({ payload: { batch: 'par' } });
      await parProbe.done;
      expect(parProbe.getMaxInFlight()).toBeGreaterThan(1);
    });

    it('sideEffectQueue runs in parallel when concurrent > 1 and shard keys differ', async () => {
      const delayMs = 80;
      const partitions = 4;
      const keys = findKeysForAllPartitions(partitions);
      const type = `side_${delayMs}`;

      const makeFlow = (domain: string, probe: ReturnType<typeof createInFlightProbe>): EventFlow<{ key: string }> =>
        withReceive({
          domain,
          type,
          samplePayload: { key: 'x' },
          getShardKey: (event) => event.payload.key,
          apply: async () => undefined,
          sideEffect: async () => {
            probe.enter();
            try {
              await delay(delayMs);
            } finally {
              probe.leave();
            }
          },
        });

      const seqProbe = createInFlightProbe(keys.length);
      const seqFlow = makeFlow('side_seq', seqProbe);
      const seqStore = await getTestEventStore([seqFlow], [], {
        mainQueueConcurrent: partitions,
        sideEffectQueueConcurrent: 1,
      });
      await Promise.all(keys.map((key) => seqStore.receive(seqFlow)({ payload: { key } })));
      await seqProbe.done;
      expect(seqProbe.getMaxInFlight()).toBe(1);
      await shutdownEventStore();

      const parProbe = createInFlightProbe(keys.length);
      const parFlow = makeFlow('side_par', parProbe);
      const parStore = await getTestEventStore([parFlow], [], {
        mainQueueConcurrent: partitions,
        sideEffectQueueConcurrent: partitions,
      });
      await Promise.all(keys.map((key) => parStore.receive(parFlow)({ payload: { key } })));
      await parProbe.done;
      expect(parProbe.getMaxInFlight()).toBeGreaterThan(1);
    });
  });

});
