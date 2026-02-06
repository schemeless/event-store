import { getTestEventStore, shutdownEventStore } from '../util/testHelpers';
import { EventFlow } from '@schemeless/event-store-types';
import delay from 'delay.ts';

describe('Sharded Queue Concurrency Verification', () => {
    // Reset event store between tests to ensure clean state
    afterEach(async () => {
        await shutdownEventStore();
    });

    it('should NOT block execution across different shards (Global Mutex Check)', async () => {
        const executionLog: string[] = [];

        // Shard A event: Slow (simulates heavy write)
        const SlowEvent: EventFlow<{ id: string }> = {
            domain: 'test',
            type: 'slow',
            getShardKey: () => 'shard-A',
            receive: (es) => es.receive(SlowEvent),
            apply: async () => {
                executionLog.push('start-A');
                await delay(200); // 200ms delay
                executionLog.push('end-A');
            }
        };

        // Shard B event: Fast (simulates light write)
        const FastEvent: EventFlow<{ id: string }> = {
            domain: 'test',
            type: 'fast',
            getShardKey: () => 'shard-B',
            receive: (es) => es.receive(FastEvent),
            apply: async () => {
                await delay(50); // Small delay to ensure A has started
                executionLog.push('start-B');
                await delay(10);
                executionLog.push('end-B');
            }
        };

        const store = await getTestEventStore([SlowEvent, FastEvent], [], { mainQueueConcurrent: 2 });
        // store.mainQueue.processed$.subscribe(); // makeEventStore already subscribes to this via output$

        // Push Slow A first, then Fast B immediately after
        const p1 = store.receive(SlowEvent)({ payload: { id: '1' } });
        const p2 = store.receive(FastEvent)({ payload: { id: '2' } });

        await Promise.all([p1, p2]);
        await store.mainQueue.drain();

        // Expected Log if Parallel (Correct):
        // start-A
        // start-B  <-- B starts while A is running
        // end-B    <-- B finishes before A
        // end-A

        // Expected Log if Serial (Bug):
        // start-A
        // end-A
        // start-B
        // end-B

        const startBIndex = executionLog.indexOf('start-B');
        const endAIndex = executionLog.indexOf('end-A');

        console.log('Execution Log:', executionLog);

        // Verification 1: B should start before A ends
        expect(startBIndex).toBeLessThan(endAIndex);

        // Verification 2: B should finish before A ends (since B is much faster)
        const endBIndex = executionLog.indexOf('end-B');
        expect(endBIndex).toBeLessThan(endAIndex);
    });

    it('should STRICTLY serialize execution within the same shard', async () => {
        const executionLog: string[] = [];

        const SerialEvent: EventFlow<{ id: string, seq: number }> = {
            domain: 'test',
            type: 'serial',
            getShardKey: () => 'shard-Same',
            receive: (es) => es.receive(SerialEvent),
            apply: async (event) => {
                executionLog.push(`start-${event.payload.seq}`);
                await delay(50);
                executionLog.push(`end-${event.payload.seq}`);
            }
        };

        const store = await getTestEventStore([SerialEvent], [], { mainQueueConcurrent: 2 });
        // store.mainQueue.processed$.subscribe(); // makeEventStore already subscribes to this via output$

        // Push 3 events to same shard
        const p1 = store.receive(SerialEvent)({ payload: { id: '1', seq: 1 } });
        const p2 = store.receive(SerialEvent)({ payload: { id: '1', seq: 2 } });
        const p3 = store.receive(SerialEvent)({ payload: { id: '1', seq: 3 } });

        await Promise.all([p1, p2, p3]);
        await store.mainQueue.drain();

        console.log('Serial Log:', executionLog);

        // Expect: start-1 -> end-1 -> start-2 -> end-2 -> start-3 -> end-3
        expect(executionLog).toEqual([
            'start-1', 'end-1',
            'start-2', 'end-2',
            'start-3', 'end-3'
        ]);
    });
});
