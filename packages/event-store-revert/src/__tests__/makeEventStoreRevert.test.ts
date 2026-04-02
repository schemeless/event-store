import { makeEventStoreRevert } from '../makeEventStoreRevert';
import { makeCompensationRegistry } from '../makeCompensationRegistry';
import type { PersistedEvent, RevertableEventStoreAdapter } from '@schemeless/event-store-types';

const mockAdapter = (): RevertableEventStoreAdapter => ({
  getEventById: jest.fn(),
  findByCausationId: jest.fn(),
  append: jest.fn(),
});

const mockEvent = (overrides: Partial<PersistedEvent> = {}): PersistedEvent =>
  ({
    id: 'event-1',
    domain: 'test',
    type: 'Created',
    payload: {},
    identifier: 'agg-1',
    sequence: 1,
    correlationId: 'corr-1',
    causationId: null,
    created: new Date(),
    ...overrides,
  } as PersistedEvent);

describe('makeEventStoreRevert', () => {
  describe('canRevert', () => {
    it('throws when event does not exist', async () => {
      const adapter = mockAdapter();
      (adapter.getEventById as jest.Mock).mockResolvedValue(null);

      const registry = makeCompensationRegistry();
      const revert = makeEventStoreRevert(adapter, registry);

      await expect(revert.canRevert('non-existent')).rejects.toThrow('Event not found: non-existent');
    });

    it('returns canRevert=true when all events have compensation', async () => {
      const adapter = mockAdapter();
      const event = mockEvent({ id: 'e1', domain: 'test', type: 'Created' });

      (adapter.getEventById as jest.Mock).mockResolvedValue(event);
      (adapter.findByCausationId as jest.Mock).mockResolvedValue([]);

      const registry = makeCompensationRegistry();
      const compensationFn = jest.fn();
      registry.register('test', 'Created', compensationFn);

      const revert = makeEventStoreRevert(adapter, registry);
      const result = await revert.canRevert('e1');

      expect(result.canRevert).toBe(true);
      expect(result.blockedBy).toBeUndefined();
    });

    it('returns canRevert=false with blockedBy when compensation is missing', async () => {
      const adapter = mockAdapter();
      const event = mockEvent({ id: 'e1', domain: 'test', type: 'Created' });

      (adapter.getEventById as jest.Mock).mockResolvedValue(event);
      (adapter.findByCausationId as jest.Mock).mockResolvedValue([]);

      const registry = makeCompensationRegistry();
      // No compensation registered

      const revert = makeEventStoreRevert(adapter, registry);
      const result = await revert.canRevert('e1');

      expect(result.canRevert).toBe(false);
      expect(result.blockedBy).toEqual([
        {
          eventId: 'e1',
          domain: 'test',
          type: 'Created',
          reason: 'No compensation registered for test::Created',
        },
      ]);
    });

    it('collects descendants recursively and checks compensation for all', async () => {
      const adapter = mockAdapter();
      const rootEvent = mockEvent({ id: 'e1', domain: 'test', type: 'Created' });
      const child1 = mockEvent({ id: 'e2', domain: 'test', type: 'ChildAdded', causationId: 'e1' });
      const child2 = mockEvent({ id: 'e3', domain: 'test', type: 'ChildAdded', causationId: 'e2' });

      (adapter.getEventById as jest.Mock).mockResolvedValue(rootEvent);
      (adapter.findByCausationId as jest.Mock).mockImplementation(async (eventId: string) => {
        if (eventId === 'e1') return [child1];
        if (eventId === 'e2') return [child2];
        return [];
      });

      const registry = makeCompensationRegistry();
      registry.register('test', 'Created', jest.fn());
      registry.register('test', 'ChildAdded', jest.fn());

      const revert = makeEventStoreRevert(adapter, registry);
      const result = await revert.canRevert('e1');

      expect(result.canRevert).toBe(true);
      expect(result.blockedBy).toBeUndefined();
    });

    it('blocks revert when descendant has no compensation', async () => {
      const adapter = mockAdapter();
      const rootEvent = mockEvent({ id: 'e1', domain: 'test', type: 'Created' });
      const child = mockEvent({ id: 'e2', domain: 'test', type: 'ChildAdded', causationId: 'e1' });

      (adapter.getEventById as jest.Mock).mockResolvedValue(rootEvent);
      (adapter.findByCausationId as jest.Mock).mockImplementation(async (eventId: string) => {
        if (eventId === 'e1') return [child];
        return [];
      });

      const registry = makeCompensationRegistry();
      registry.register('test', 'Created', jest.fn());
      // NOT registering compensation for 'ChildAdded'

      const revert = makeEventStoreRevert(adapter, registry);
      const result = await revert.canRevert('e1');

      expect(result.canRevert).toBe(false);
      expect(result.blockedBy).toEqual([
        {
          eventId: 'e2',
          domain: 'test',
          type: 'ChildAdded',
          reason: 'No compensation registered for test::ChildAdded',
        },
      ]);
    });
  });

  describe('previewRevert', () => {
    it('returns rootEvent and descendantEvents', async () => {
      const adapter = mockAdapter();
      const rootEvent = mockEvent({ id: 'e1', domain: 'test', type: 'Created' });
      const child = mockEvent({ id: 'e2', domain: 'test', type: 'ChildAdded', causationId: 'e1' });

      (adapter.getEventById as jest.Mock).mockResolvedValue(rootEvent);
      (adapter.findByCausationId as jest.Mock).mockImplementation(async (eventId: string) => {
        if (eventId === 'e1') return [child];
        return [];
      });

      const registry = makeCompensationRegistry();
      const revert = makeEventStoreRevert(adapter, registry);
      const result = await revert.previewRevert('e1');

      expect(result.rootEvent).toEqual(rootEvent);
      expect(result.descendantEvents).toEqual([child]);
    });

    it('throws when event not found', async () => {
      const adapter = mockAdapter();
      (adapter.getEventById as jest.Mock).mockResolvedValue(null);

      const registry = makeCompensationRegistry();
      const revert = makeEventStoreRevert(adapter, registry);

      await expect(revert.previewRevert('non-existent')).rejects.toThrow('Event not found: non-existent');
    });

    it('returns empty descendantEvents when no children', async () => {
      const adapter = mockAdapter();
      const event = mockEvent({ id: 'e1', domain: 'test', type: 'Created' });

      (adapter.getEventById as jest.Mock).mockResolvedValue(event);
      (adapter.findByCausationId as jest.Mock).mockResolvedValue([]);

      const registry = makeCompensationRegistry();
      const revert = makeEventStoreRevert(adapter, registry);
      const result = await revert.previewRevert('e1');

      expect(result.rootEvent).toEqual(event);
      expect(result.descendantEvents).toEqual([]);
    });
  });

  describe('revert', () => {
    it('throws when compensation is missing during revert', async () => {
      const adapter = mockAdapter();
      const event = mockEvent({ id: 'e1', domain: 'test', type: 'Created' });

      (adapter.getEventById as jest.Mock).mockResolvedValue(event);
      (adapter.findByCausationId as jest.Mock).mockResolvedValue([]);

      const registry = makeCompensationRegistry();
      // No compensation registered
      const revert = makeEventStoreRevert(adapter, registry);

      await expect(revert.revert('e1')).rejects.toThrow('Cannot revert: no compensation registered for test::Created');
    });

    it('appends compensating events in post-order (leaves first)', async () => {
      const adapter = mockAdapter();
      const rootEvent = mockEvent({ id: 'e1', domain: 'test', type: 'Created', sequence: 2 });
      const childEvent = mockEvent({ id: 'e2', domain: 'test', type: 'ChildAdded', causationId: 'e1', sequence: 1 });

      (adapter.getEventById as jest.Mock).mockResolvedValue(rootEvent);
      (adapter.findByCausationId as jest.Mock).mockImplementation(async (eventId: string) => {
        if (eventId === 'e1') return [childEvent];
        if (eventId === 'e2') return [];
        return [];
      });
      (adapter.append as jest.Mock).mockResolvedValue(undefined);

      const registry = makeCompensationRegistry();
      const compensateChild = jest
        .fn()
        .mockReturnValue({ id: 'c2', domain: 'test', type: 'ChildRemoved', payload: {} });
      const compensateRoot = jest.fn().mockReturnValue({ id: 'c1', domain: 'test', type: 'Reversed', payload: {} });
      registry.register('test', 'ChildAdded', compensateChild);
      registry.register('test', 'Created', compensateRoot);

      const revert = makeEventStoreRevert(adapter, registry);
      await revert.revert('e1');

      expect(adapter.append).toHaveBeenCalled();
      const appendedEvents = (adapter.append as jest.Mock).mock.calls[0][0];
      // post-order means leaves first: child (c2) comes before root (c1)
      expect(appendedEvents[0].type).toBe('ChildRemoved');
      expect(appendedEvents[1].type).toBe('Reversed');
    });

    it('buildCompensatingEvent sets isCompensating meta and correct causationId', async () => {
      const adapter = mockAdapter();
      const event = mockEvent({ id: 'e1', domain: 'test', type: 'Created', correlationId: 'corr-1' });

      (adapter.getEventById as jest.Mock).mockResolvedValue(event);
      (adapter.findByCausationId as jest.Mock).mockResolvedValue([]);
      (adapter.append as jest.Mock).mockResolvedValue(undefined);

      const registry = makeCompensationRegistry();
      registry.register(
        'test',
        'Created',
        jest.fn().mockReturnValue({ id: 'c1', domain: 'test', type: 'Reversed', payload: {} })
      );

      const revert = makeEventStoreRevert(adapter, registry);
      await revert.revert('e1');

      const appendedEvents = (adapter.append as jest.Mock).mock.calls[0][0];
      const compensatingEvent = appendedEvents[0];
      expect(compensatingEvent.meta.isCompensating).toBe(true);
      expect(compensatingEvent.meta.compensatesEventId).toBe('e1');
      expect(compensatingEvent.correlationId).toBe('corr-1');
      expect(compensatingEvent.causationId).toBe('e1');
    });

    it('compensation function returning array produces multiple compensating events', async () => {
      const adapter = mockAdapter();
      const event = mockEvent({ id: 'e1', domain: 'test', type: 'BatchCreated' });

      (adapter.getEventById as jest.Mock).mockResolvedValue(event);
      (adapter.findByCausationId as jest.Mock).mockResolvedValue([]);
      (adapter.append as jest.Mock).mockResolvedValue(undefined);

      const registry = makeCompensationRegistry();
      registry.register(
        'test',
        'BatchCreated',
        jest.fn().mockReturnValue([
          { id: 'c1', domain: 'test', type: 'ItemRemoved', payload: {} },
          { id: 'c2', domain: 'test', type: 'BatchCancelled', payload: {} },
        ])
      );

      const revert = makeEventStoreRevert(adapter, registry);
      await revert.revert('e1');

      const appendedEvents = (adapter.append as jest.Mock).mock.calls[0][0];
      expect(appendedEvents).toHaveLength(2);
      expect(appendedEvents[0].type).toBe('ItemRemoved');
      expect(appendedEvents[1].type).toBe('BatchCancelled');
    });

    it('compensating event has sequence: undefined', async () => {
      const adapter = mockAdapter();
      const event = mockEvent({ id: 'e1', domain: 'test', type: 'Created', sequence: 5 });

      (adapter.getEventById as jest.Mock).mockResolvedValue(event);
      (adapter.findByCausationId as jest.Mock).mockResolvedValue([]);
      (adapter.append as jest.Mock).mockResolvedValue(undefined);

      const registry = makeCompensationRegistry();
      registry.register(
        'test',
        'Created',
        jest.fn().mockReturnValue({ id: 'c1', domain: 'test', type: 'Reversed', payload: {} })
      );

      const revert = makeEventStoreRevert(adapter, registry);
      await revert.revert('e1');

      const appendedEvents = (adapter.append as jest.Mock).mock.calls[0][0];
      expect(appendedEvents[0].sequence).toBeUndefined();
    });

    it('compensating event has created: new Date()', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-04-01T00:00:00.000Z'));
      try {
        const adapter = mockAdapter();
        const event = mockEvent({ id: 'e1', domain: 'test', type: 'Created' });

        (adapter.getEventById as jest.Mock).mockResolvedValue(event);
        (adapter.findByCausationId as jest.Mock).mockResolvedValue([]);
        (adapter.append as jest.Mock).mockResolvedValue(undefined);

        const registry = makeCompensationRegistry();
        registry.register(
          'test',
          'Created',
          jest.fn().mockReturnValue({ id: 'c1', domain: 'test', type: 'Reversed', payload: {} })
        );

        const revert = makeEventStoreRevert(adapter, registry);
        await revert.revert('e1');

        const appendedEvents = (adapter.append as jest.Mock).mock.calls[0][0];
        expect(appendedEvents[0].created).toEqual(new Date('2026-04-01T00:00:00.000Z'));
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
