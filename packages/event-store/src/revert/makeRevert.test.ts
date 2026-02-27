// Revert tests - Compatible with both Jest and Vitest (globals)
import type { CreatedEvent, EventFlow, EventFlowMap } from '@schemeless/event-store-types';
import { makeRevert } from './makeRevert';

describe('makeRevert', () => {
  let mockRepo: any;
  let eventFlowMap: EventFlowMap;
  let storeEvents: any;

  const createMockEvent = (id: string, domain: string, type: string, causationId?: string): CreatedEvent<any> => ({
    id,
    domain,
    type,
    payload: { data: 'test' },
    correlationId: 'corr-1',
    causationId,
    created: new Date(),
  });

  beforeEach(() => {
    mockRepo = {
      init: jest.fn(),
      getAllEvents: jest.fn(),
      createEventEntity: jest.fn(),
      storeEvents: jest.fn(),
      resetStore: jest.fn(),
      getEventById: jest.fn(),
      findByCausationId: jest.fn(),
    };

    storeEvents = jest.fn().mockResolvedValue(undefined);

    const orderPlacedFlow: EventFlow = {
      domain: 'order',
      type: 'placed',
      receive: jest.fn() as any,
      compensate: (event) => ({
        domain: 'order',
        type: 'voided',
        payload: { orderId: event.payload.orderId },
      }),
    };

    const accountTransferFlow: EventFlow = {
      domain: 'account',
      type: 'transfer',
      receive: jest.fn() as any,
      compensate: (event) => ({
        domain: 'account',
        type: 'reverseTransfer',
        payload: { transferId: event.id },
      }),
    };

    eventFlowMap = {
      order__placed: orderPlacedFlow,
      account__transfer: accountTransferFlow,
    };
  });

  describe('canRevert', () => {
    it('should return false if repo does not support revert operations', async () => {
      const repoWithoutSupport = { ...mockRepo, getEventById: undefined };
      const { canRevert } = makeRevert({ repo: repoWithoutSupport as any, eventFlowMap, storeEvents });
      await expect(canRevert('evt-1')).rejects.toThrow('Revert operations require repository to implement');
    });

    it('should return false if event not found', async () => {
      mockRepo.getEventById.mockResolvedValue(null);
      const { canRevert } = makeRevert({ repo: mockRepo, eventFlowMap, storeEvents });
      const result = await canRevert('evt-404');
      expect(result).toEqual({
        canRevert: false,
        reason: 'Event not found: evt-404',
      });
    });

    it('should return false if event is not a root event', async () => {
      const nonRootEvent = createMockEvent('evt-2', 'account', 'transfer', 'evt-1');
      mockRepo.getEventById.mockResolvedValue(nonRootEvent);
      const { canRevert } = makeRevert({ repo: mockRepo, eventFlowMap, storeEvents });
      const result = await canRevert('evt-2');
      expect(result).toEqual({
        canRevert: false,
        reason: 'Event evt-2 is not a root event. It was caused by event evt-1. Please revert the root event instead.',
      });
    });

    it('should return false if any event in tree lacks compensate hook', async () => {
      const rootEvent = createMockEvent('evt-1', 'order', 'placed');
      const childEvent = createMockEvent('evt-2', 'account', 'transfer', 'evt-1');

      mockRepo.getEventById.mockResolvedValue(rootEvent);
      // FIXED: Use mockImplementation to avoid infinite loop
      mockRepo.findByCausationId.mockImplementation(async (id: string) => {
        if (id === 'evt-1') return [childEvent];
        return [];
      });

      const flowMapWithoutCompensate: EventFlowMap = {
        order__placed: eventFlowMap['order__placed'],
        account__transfer: {
          domain: 'account',
          type: 'transfer',
          receive: jest.fn() as any,
        },
      };

      const { canRevert } = makeRevert({ repo: mockRepo, eventFlowMap: flowMapWithoutCompensate, storeEvents });
      const result = await canRevert('evt-1');
      expect(result.canRevert).toBe(false);
      expect(result.reason).toContain("do not define a 'compensate' hook");
    });

    it('should return true if root event and all descendants have compensate hooks', async () => {
      const rootEvent = createMockEvent('evt-1', 'order', 'placed');
      const childEvent = createMockEvent('evt-2', 'account', 'transfer', 'evt-1');

      mockRepo.getEventById.mockResolvedValue(rootEvent);
      // FIXED: Use mockImplementation
      mockRepo.findByCausationId.mockImplementation(async (id: string) => {
        if (id === 'evt-1') return [childEvent];
        return [];
      });

      const { canRevert } = makeRevert({ repo: mockRepo, eventFlowMap, storeEvents });
      const result = await canRevert('evt-1');
      expect(result).toEqual({ canRevert: true });
    });
  });

  describe('previewRevert', () => {
    it('should throw if event not found', async () => {
      mockRepo.getEventById.mockResolvedValue(null);
      const { previewRevert } = makeRevert({ repo: mockRepo, eventFlowMap, storeEvents });
      await expect(previewRevert('evt-404')).rejects.toThrow('Event not found: evt-404');
    });

    it('should throw if event is not a root event', async () => {
      const nonRootEvent = createMockEvent('evt-2', 'account', 'transfer', 'evt-1');
      mockRepo.getEventById.mockResolvedValue(nonRootEvent);
      const { previewRevert } = makeRevert({ repo: mockRepo, eventFlowMap, storeEvents });
      await expect(previewRevert('evt-2')).rejects.toThrow('Cannot preview revert for non-root event');
    });

    it('should return root event and all descendants', async () => {
      const rootEvent = createMockEvent('evt-1', 'order', 'placed');
      const child1 = createMockEvent('evt-2', 'account', 'transfer', 'evt-1');
      const child2 = createMockEvent('evt-3', 'account', 'transfer', 'evt-2');

      mockRepo.getEventById.mockResolvedValue(rootEvent);
      // FIXED: Use mockImplementation with proper tree structure
      mockRepo.findByCausationId.mockImplementation(async (id: string) => {
        if (id === 'evt-1') return [child1];
        if (id === 'evt-2') return [child2];
        return [];
      });

      const { previewRevert } = makeRevert({ repo: mockRepo, eventFlowMap, storeEvents });
      const result = await previewRevert('evt-1');
      expect(result.rootEvent).toEqual(rootEvent);
      expect(result.descendantEvents).toHaveLength(2);
      expect(result.totalEventCount).toBe(3);
    });
  });

  describe('revert', () => {
    it('should throw if event cannot be reverted', async () => {
      const nonRootEvent = createMockEvent('evt-2', 'account', 'transfer', 'evt-1');
      mockRepo.getEventById.mockResolvedValue(nonRootEvent);
      const { revert } = makeRevert({ repo: mockRepo, eventFlowMap, storeEvents });
      await expect(revert('evt-2')).rejects.toThrow('Cannot revert event evt-2');
    });

    it('should revert a single root event with no children', async () => {
      const rootEvent = createMockEvent('evt-1', 'order', 'placed');
      mockRepo.getEventById.mockResolvedValue(rootEvent);
      mockRepo.findByCausationId.mockResolvedValue([]);

      const { revert } = makeRevert({ repo: mockRepo, eventFlowMap, storeEvents });
      const result = await revert('evt-1');
      expect(result.revertedEventId).toBe('evt-1');
      expect(result.compensatingEvents).toHaveLength(1);
      expect(storeEvents).toHaveBeenCalled();
    });

    it('should revert event tree in correct order (leaves first)', async () => {
      const rootEvent = createMockEvent('evt-1', 'order', 'placed');
      const child1 = createMockEvent('evt-2', 'account', 'transfer', 'evt-1');
      const child2 = createMockEvent('evt-3', 'account', 'transfer', 'evt-1');

      mockRepo.getEventById.mockResolvedValue(rootEvent);
      // FIXED: Use mockImplementation
      mockRepo.findByCausationId.mockImplementation(async (id: string) => {
        if (id === 'evt-1') return [child1, child2];
        return [];
      });

      const { revert } = makeRevert({ repo: mockRepo, eventFlowMap, storeEvents });
      const result = await revert('evt-1');
      expect(result.revertedEventId).toBe('evt-1');
      expect(result.childResults).toHaveLength(2);
    });

    it('should add compensation metadata to generated events', async () => {
      const rootEvent = createMockEvent('evt-1', 'order', 'placed');
      mockRepo.getEventById.mockResolvedValue(rootEvent);
      mockRepo.findByCausationId.mockResolvedValue([]);

      const { revert } = makeRevert({ repo: mockRepo, eventFlowMap, storeEvents });
      await revert('evt-1');

      const storedEvents = storeEvents.mock.calls[0][0];
      expect(storedEvents[0].meta).toMatchObject({
        isCompensating: true,
        compensatesEventId: 'evt-1',
      });
    });

    it('should handle compensate returning array of events', async () => {
      const multiCompensateFlow: EventFlow = {
        domain: 'order',
        type: 'multiple',
        receive: jest.fn() as any,
        compensate: () => [
          { domain: 'order', type: 'cancel', payload: {} },
          { domain: 'order', type: 'refund', payload: {} },
        ],
      };

      const flowMap = { order__multiple: multiCompensateFlow };
      const rootEvent = createMockEvent('evt-1', 'order', 'multiple');
      mockRepo.getEventById.mockResolvedValue(rootEvent);
      mockRepo.findByCausationId.mockResolvedValue([]);

      const { revert } = makeRevert({ repo: mockRepo, eventFlowMap: flowMap, storeEvents });
      const result = await revert('evt-1');
      expect(result.compensatingEvents).toHaveLength(2);
    });

    it('should preserve existing meta when adding compensation metadata', async () => {
      const flowWithMeta: EventFlow = {
        domain: 'order',
        type: 'withMeta',
        receive: jest.fn() as any,
        compensate: () =>
          ({
            domain: 'order',
            type: 'cancel',
            payload: {},
            meta: { existingField: 'value' },
          } as any),
      };

      const flowMap = { order__withMeta: flowWithMeta };
      const rootEvent = createMockEvent('evt-1', 'order', 'withMeta');
      mockRepo.getEventById.mockResolvedValue(rootEvent);
      mockRepo.findByCausationId.mockResolvedValue([]);

      const { revert } = makeRevert({ repo: mockRepo, eventFlowMap: flowMap, storeEvents });
      await revert('evt-1');

      const storedEvents = storeEvents.mock.calls[0][0];
      expect(storedEvents[0].meta).toMatchObject({
        existingField: 'value',
        isCompensating: true,
        compensatesEventId: 'evt-1',
      });
    });

    it('should automatically populate id, created, and tracing fields for compensating events', async () => {
      const rootEvent = createMockEvent('evt-1', 'order', 'placed');
      rootEvent.identifier = 'user-1';
      rootEvent.correlationId = 'corr-123';

      mockRepo.getEventById.mockResolvedValue(rootEvent);
      mockRepo.findByCausationId.mockResolvedValue([]);

      const { revert } = makeRevert({ repo: mockRepo, eventFlowMap, storeEvents });
      const result = await revert('evt-1');

      const compEvent = result.compensatingEvents[0];
      expect(compEvent.id).toBeDefined();
      expect(compEvent.id).not.toBe(rootEvent.id);
      expect(compEvent.created).toBeInstanceOf(Date);
      expect(compEvent.causationId).toBe(rootEvent.id);
      expect(compEvent.correlationId).toBe(rootEvent.correlationId);
      expect(compEvent.identifier).toBe(rootEvent.identifier);
    });

    it('should inject schemaVersion from flow into compensating events', async () => {
      const flowWithVersion: EventFlow = {
        domain: 'order',
        type: 'versioned',
        schemaVersion: 5,
        receive: jest.fn() as any,
        compensate: () => ({ domain: 'order', type: 'reverted_v', payload: {} }),
      };

      const revertedFlow: EventFlow = {
        domain: 'order',
        type: 'reverted_v',
        schemaVersion: 2,
        receive: jest.fn() as any,
      };

      const flowMap = {
        order__versioned: flowWithVersion,
        order__reverted_v: revertedFlow,
      };

      const rootEvent = createMockEvent('evt-1', 'order', 'versioned');
      mockRepo.getEventById.mockResolvedValue(rootEvent);
      mockRepo.findByCausationId.mockResolvedValue([]);

      const { revert } = makeRevert({ repo: mockRepo, eventFlowMap: flowMap, storeEvents });
      const result = await revert('evt-1');

      expect(result.compensatingEvents[0].meta?.schemaVersion).toBe(2);
    });

    it('should overwrite manual id in compensate() to ensure uniqueness', async () => {
      const flow: EventFlow = {
        domain: 'order',
        type: 'placed',
        receive: jest.fn() as any,
        compensate: () => ({
          domain: 'order',
          type: 'voided',
          id: 'manual-id',
          payload: {},
        }),
      };

      const flowMap = { order__placed: flow };
      const rootEvent = createMockEvent('evt-1', 'order', 'placed');
      mockRepo.getEventById.mockResolvedValue(rootEvent);
      mockRepo.findByCausationId.mockResolvedValue([]);

      const { revert } = makeRevert({ repo: mockRepo, eventFlowMap: flowMap, storeEvents });
      const result = await revert('evt-1');

      expect(result.compensatingEvents[0].id).toBeDefined();
      expect(result.compensatingEvents[0].id).not.toBe('manual-id');
    });

    it('should correctly set causationId in deep trees', async () => {
      const rootEvent = createMockEvent('root', 'order', 'placed');
      const child = createMockEvent('child', 'account', 'transfer', 'root');
      const grandchild = createMockEvent('grandchild', 'account', 'transfer', 'child');

      mockRepo.getEventById.mockResolvedValue(rootEvent);
      mockRepo.findByCausationId.mockImplementation(async (id: string) => {
        if (id === 'root') return [child];
        if (id === 'child') return [grandchild];
        return [];
      });

      const { revert } = makeRevert({ repo: mockRepo, eventFlowMap, storeEvents });
      const result = await revert('root');

      // Order: grandchild -> child -> root
      expect(result.childResults[0].childResults[0].revertedEventId).toBe('grandchild');
      expect(result.childResults[0].childResults[0].compensatingEvents[0].causationId).toBe('grandchild');

      expect(result.childResults[0].revertedEventId).toBe('child');
      expect(result.childResults[0].compensatingEvents[0].causationId).toBe('child');

      expect(result.revertedEventId).toBe('root');
      expect(result.compensatingEvents[0].causationId).toBe('root');
    });
  });
});
