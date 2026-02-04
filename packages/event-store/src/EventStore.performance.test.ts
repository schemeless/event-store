import { getTestEventStore, shutdownEventStore } from './util/testHelpers';
import { StandardEvent, testEventFlows } from './mocks';
import { CreatedEvent, SuccessEventObserver } from '@schemeless/event-store-types';
import delay from 'delay.ts';

// Helper to create a slow event flow dynamically
const createSlowFlow = (delayMs: number) => {
    const Flow = { ...StandardEvent };
    Flow.type = `slow_${delayMs}`;
    Flow.apply = async (event: CreatedEvent<any>) => {
        await delay(delayMs);
    };
    return Flow;
};

describe('EventStore Extended Performance Verification', () => {
    afterEach(async () => {
        await shutdownEventStore();
    });

    describe('1. Concurrency Performance', () => {
        const prepareTest = () => {
            const delayMs = 50;
            const eventCount = 5;
            const SlowFlow = createSlowFlow(delayMs);
            return { delayMs, eventCount, SlowFlow };
        };

        it('should process mainQueue events significantly faster with concurrency > 1', async () => {
            const { delayMs, eventCount, SlowFlow } = prepareTest();

            // 1. Sequential (Concurrent: 1)
            const seqStore = await getTestEventStore([{ ...SlowFlow, domain: 'seq' }], [], { mainQueueConcurrent: 1 });
            const startSeq = Date.now();
            await Promise.all(
                Array.from({ length: eventCount }).map((_, i) =>
                    seqStore.receive({ ...SlowFlow, domain: 'seq' })({ payload: { key: `seq_${i}`, positiveNumber: 1 } })
                )
            );
            const durationSeq = Date.now() - startSeq;
            await shutdownEventStore();

            // 2. Parallel (Concurrent: 5)
            const parStore = await getTestEventStore([{ ...SlowFlow, domain: 'par' }], [], { mainQueueConcurrent: 5 });
            const startPar = Date.now();
            await Promise.all(
                Array.from({ length: eventCount }).map((_, i) =>
                    parStore.receive({ ...SlowFlow, domain: 'par' })({ payload: { key: `par_${i}`, positiveNumber: 1 } })
                )
            );
            const durationPar = Date.now() - startPar;

            console.log(`MainQueue Sequential: ${durationSeq}ms, Parallel: ${durationPar}ms`);

            // Expected: Sequential ~250ms, Parallel ~50ms + overhead
            expect(durationPar).toBeLessThan(durationSeq * 0.6);
        });

        it('should process observerQueue events significantly faster with concurrency > 1', async () => {
            const { delayMs, eventCount, SlowFlow } = prepareTest();
            // Slow observer
            const slowObserver: SuccessEventObserver<any> = {
                filters: [{ domain: 'obs', type: `slow_${delayMs}` }],
                priority: 1,
                apply: async () => { await delay(delayMs); }
            };

            // 1. Sequential Observer
            const seqStore = await getTestEventStore([{ ...SlowFlow, domain: 'obs' }], [slowObserver], { observerQueueConcurrent: 1 });
            // For observers to run in parallel, we need to fire multiple events and wait for them to be processed.
            // But receive() returns when mainQueue is done. Observers run async in background (piped from mainQueue processed).
            // So we need to wait for all observers to finish.

            // We can't easily await observers from outside without a hook.
            // Workaround: Send N events, and check total time until a flag is set? 
            // Better: use a latch/counter in the observer.

            // Let's skip strict timing check for observers if it's too complex to coordinate, 
            // OR use a specialized Observer that resolves a promise when N are done.

            const createLatchObserver = (total: number) => {
                let count = 0;
                let resolveFn: () => void;
                const promise = new Promise<void>(r => resolveFn = r);
                const observer: SuccessEventObserver<any> = {
                    filters: [{ domain: 'obs', type: `slow_${delayMs}` }],
                    priority: 1,
                    apply: async () => {
                        await delay(delayMs);
                        count++;
                        if (count === total) resolveFn();
                    }
                };
                return { observer, promise };
            };

            const latchSeq = createLatchObserver(eventCount);

            const startSeq = Date.now();
            await Promise.all(
                Array.from({ length: eventCount }).map((_, i) =>
                    seqStore.receive({ ...SlowFlow, domain: 'obs' })({ payload: { key: `seq_${i}`, positiveNumber: 1 } })
                )
            );
            await latchSeq.promise;
            const durationSeq = Date.now() - startSeq;
            await shutdownEventStore();

            // 2. Parallel Observer
            const latchPar = createLatchObserver(eventCount);
            const parStore = await getTestEventStore([{ ...SlowFlow, domain: 'obs' }], [latchPar.observer], { observerQueueConcurrent: 5 });

            const startPar = Date.now();
            await Promise.all(
                Array.from({ length: eventCount }).map((_, i) =>
                    parStore.receive({ ...SlowFlow, domain: 'obs' })({ payload: { key: `par_${i}`, positiveNumber: 1 } })
                )
            );
            await latchPar.promise;
            const durationPar = Date.now() - startPar;

            console.log(`ObserverQueue Sequential: ${durationSeq}ms, Parallel: ${durationPar}ms`);
            expect(durationPar).toBeLessThan(durationSeq * 0.6);
        });
        it('should process sideEffectQueue events significantly faster with concurrency > 1', async () => {
            const { delayMs, eventCount, SlowFlow } = prepareTest();

            const createLatchSideEffectFlow = (total: number) => {
                let count = 0;
                let resolveFn: () => void;
                const promise = new Promise<void>(r => resolveFn = r);

                const Flow = { ...SlowFlow, domain: 'side' };
                // fast apply
                Flow.apply = async () => { };
                // slow sideEffect
                Flow.sideEffect = async () => {
                    await delay(delayMs);
                    count++;
                    if (count === total) resolveFn();
                };
                return { Flow, promise };
            };

            // 1. Sequential SideEffect
            const latchSeq = createLatchSideEffectFlow(eventCount);
            const seqStore = await getTestEventStore([{ ...latchSeq.Flow, domain: 'side_seq' }], [], { sideEffectQueueConcurrent: 1 });

            const startSeq = Date.now();
            await Promise.all(
                Array.from({ length: eventCount }).map((_, i) =>
                    seqStore.receive({ ...latchSeq.Flow, domain: 'side_seq' })({ payload: { key: `seq_${i}`, positiveNumber: 1 } })
                )
            );
            await latchSeq.promise;
            const durationSeq = Date.now() - startSeq;
            await shutdownEventStore();

            // 2. Parallel SideEffect
            const latchPar = createLatchSideEffectFlow(eventCount);
            const parStore = await getTestEventStore([{ ...latchPar.Flow, domain: 'side_par' }], [], { sideEffectQueueConcurrent: 5 });

            const startPar = Date.now();
            await Promise.all(
                Array.from({ length: eventCount }).map((_, i) =>
                    parStore.receive({ ...latchPar.Flow, domain: 'side_par' })({ payload: { key: `par_${i}`, positiveNumber: 1 } })
                )
            );
            await latchPar.promise;
            const durationPar = Date.now() - startPar;

            console.log(`SideEffectQueue Sequential: ${durationSeq}ms, Parallel: ${durationPar}ms`);
            expect(durationPar).toBeLessThan(durationSeq * 0.6);
        });
    });

    describe('2. Fire-and-Forget Robustness', () => {
        it('should continue processing when a fire-and-forget observer throws', async () => {
            const errorObserver: SuccessEventObserver<any> = {
                filters: [{ domain: 'err', type: 'test' }],
                priority: 1,
                fireAndForget: true,
                apply: async () => {
                    throw new Error('Boom');
                }
            };

            const store = await getTestEventStore([StandardEvent], [errorObserver]);

            // Should not throw
            await expect(
                StandardEvent.receive(store)({ payload: { key: 'robust', positiveNumber: 1 } })
            ).resolves.not.toThrow();

            // Should be able to process next event
            await expect(
                StandardEvent.receive(store)({ payload: { key: 'robust_2', positiveNumber: 1 } })
            ).resolves.not.toThrow();
        });
    });

    describe('3. Ordering Verification (Main Queue)', () => {
        // This is hard to deterministically prove "out of order" without a lot of runs.
        // But we can prove that they start/overlap.
        it('should allow overlapping execution in mainQueue', async () => {
            const delayMs = 100;
            const Flow = createSlowFlow(delayMs);
            // Use a shared resource to detect overlap
            let inFlight = 0;
            let maxInFlight = 0;

            Flow.apply = async () => {
                inFlight++;
                maxInFlight = Math.max(maxInFlight, inFlight);
                await delay(delayMs);
                inFlight--;
            };

            const store = await getTestEventStore([{ ...Flow, domain: 'overlap' }], [], { mainQueueConcurrent: 2 });

            // Send 2 events rapidly
            const p1 = store.receive({ ...Flow, domain: 'overlap' })({ payload: { key: '1', positiveNumber: 1 } });
            const p2 = store.receive({ ...Flow, domain: 'overlap' })({ payload: { key: '2', positiveNumber: 1 } });

            await Promise.all([p1, p2]);

            expect(maxInFlight).toBeGreaterThan(1);
        });
    });
});
