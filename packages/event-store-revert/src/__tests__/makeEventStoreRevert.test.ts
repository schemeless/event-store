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
  });
});
