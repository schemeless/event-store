import { getTestEventStore, shutdownEventStore } from '../util/testHelpers';
import { EventFlow, SuccessEventObserver } from '@schemeless/event-store-types';
import { sideEffectFinishedPromise } from '../util/sideEffectFinishedPromise';

describe('Sharded Queue High Stress Verification', () => {
    afterEach(async () => {
        await shutdownEventStore();
    });

    it('should handle high concurrency with mixed workload (200+ events, child events, observers)', async () => {
        jest.setTimeout(30000); // 30 second timeout for this test

        const EVENTS_PER_USER = 10;
        const USER_COUNT = 20;
        const TOTAL_ROOT_EVENTS = EVENTS_PER_USER * USER_COUNT; // 200
        const SHARD_COUNT = 10;

        // Tracking metrics
        const metrics = {
            rootProcessed: 0,
            childProcessed: 0,
            observerProcessed: 0,
            aggregates: {} as Record<string, number[]>, // Sequence tracking per aggregate
        };

        // Expected total events in output$: 
        // 200 root (success) + 200 child (success) = 400
        let outputEventCount = 0;
        const EXPECTED_OUTPUT_EVENTS = TOTAL_ROOT_EVENTS * 2; // root + child

        // 1. Root Event (UserAction)
        const RootEvent: EventFlow<{ userId: string; seq: number }> = {
            domain: 'stress',
            type: 'root',
            getShardKey: (e) => e.payload.userId,
            receive: (es) => es.receive(RootEvent),
            apply: async (event) => {
                metrics.rootProcessed++;
                const { userId, seq } = event.payload;

                if (!metrics.aggregates[userId]) metrics.aggregates[userId] = [];
                metrics.aggregates[userId].push(seq);
            },
            sideEffect: async (event) => {
                return [{
                    domain: 'stress',
                    type: 'child',
                    payload: {
                        parentId: event.id,
                        userId: event.payload.userId
                    }
                }];
            }
        };

        // 2. Child Event (SystemReaction)
        const ChildEvent: EventFlow<{ parentId: string; userId: string }> = {
            domain: 'stress',
            type: 'child',
            getShardKey: (e) => e.payload.userId,
            receive: (es) => es.receive(ChildEvent),
            apply: async () => {
                metrics.childProcessed++;
            }
        };

        // 3. Observer (ReadModel Updater)
        const MetricsObserver: SuccessEventObserver<{ userId: string }> = {
            priority: 1,
            filters: [{ domain: 'stress', type: 'root' }],
            apply: async () => {
                metrics.observerProcessed++;
            }
        };

        // Initialize Store with shards
        const store = await getTestEventStore(
            [RootEvent, ChildEvent],
            [MetricsObserver],
            { mainQueueConcurrent: SHARD_COUNT, sideEffectQueueConcurrent: SHARD_COUNT }
        );

        // Subscribe to output$ to count completion
        const outputSubscription = store.output$.subscribe(() => {
            outputEventCount++;
        });

        console.log(`🚀 Starting Stress Test: ${TOTAL_ROOT_EVENTS} events via ${USER_COUNT} User Agents (${EVENTS_PER_USER} events each)...`);
        const startTime = Date.now();

        // USER AGENT PATTERN: Each user sends events SERIALLY
        // Different users send events in PARALLEL
        const userAgents = Array.from({ length: USER_COUNT }, (_, userIdx) => {
            const userId = `user-${userIdx}`;

            // Serial event sending per user
            return (async () => {
                for (let seq = 0; seq < EVENTS_PER_USER; seq++) {
                    await store.receive(RootEvent)({
                        payload: { userId, seq }
                    });
                }
            })();
        });

        // Wait for all user agents to finish sending
        await Promise.all(userAgents);
        console.log(`📤 All events dispatched`);

        // EVENT-DRIVEN WAITING: Wait for main queue, then poll for all child events
        await store.mainQueue.drain();
        console.log(`✅ Main queue drained`);

        // Poll for all child events to complete (more reliable than sideEffectFinishedPromise)
        const waitForSideEffects = async (maxWaitMs = 15000) => {
            const startWait = Date.now();
            while (metrics.childProcessed < TOTAL_ROOT_EVENTS) {
                if (Date.now() - startWait > maxWaitMs) {
                    console.warn(`⚠️ Side effect timeout after ${maxWaitMs}ms. Processed ${metrics.childProcessed}/${TOTAL_ROOT_EVENTS}`);
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        };
        await waitForSideEffects();
        console.log(`✅ Side effects finished`);

        // Small delay for observers (they run async after mainQueue completes)
        // Use a polling approach instead of blind delay
        const waitForObservers = async (maxWaitMs = 10000) => {
            const startWait = Date.now();
            while (metrics.observerProcessed < TOTAL_ROOT_EVENTS) {
                if (Date.now() - startWait > maxWaitMs) {
                    console.warn(`⚠️ Observer timeout after ${maxWaitMs}ms`);
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        };
        await waitForObservers();

        const duration = Date.now() - startTime;
        console.log(`🏁 Finished in ${duration}ms`);
        console.log('Metrics:', {
            root: metrics.rootProcessed,
            child: metrics.childProcessed,
            observer: metrics.observerProcessed,
            outputEvents: outputEventCount
        });

        // Clean up subscription
        outputSubscription.unsubscribe();

        // Assertions

        // 1. Completeness
        expect(metrics.rootProcessed).toBe(TOTAL_ROOT_EVENTS);
        expect(metrics.childProcessed).toBe(TOTAL_ROOT_EVENTS); // 1:1 ratio
        expect(metrics.observerProcessed).toBe(TOTAL_ROOT_EVENTS); // 1:1 ratio

        // 2. Ordering Verification (Per Aggregate)
        // Since each user agent sends events serially with await,
        // the sequence MUST be [0, 1, 2, ..., 9] for each user
        Object.entries(metrics.aggregates).forEach(([userId, seqs]) => {
            const expected = Array.from({ length: EVENTS_PER_USER }, (_, i) => i);
            expect(seqs).toEqual(expected);
        });

        // 3. All users processed
        expect(Object.keys(metrics.aggregates).length).toBe(USER_COUNT);
    });
});
