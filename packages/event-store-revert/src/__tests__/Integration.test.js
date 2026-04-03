const { PgEventStoreAdapter } = require('@schemeless/event-store-adapter-pg');
const { makeCompensationRegistry, makeEventStoreRevert } = require('../../dist');

const connectionOptions = {
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'event_store_test',
};

let eventCounter = 0;
const makeEvent = (domain, type, payload, identifier) => ({
  id: `e-${Date.now()}-${++eventCounter}`,
  domain,
  type,
  payload,
  identifier,
  created: new Date(),
});

describe('Revert + PG Integration', () => {
  let adapter;
  let registry;
  let revert;

  beforeAll(async () => {
    adapter = new PgEventStoreAdapter(connectionOptions);
    await adapter.init();
    registry = makeCompensationRegistry();
    revert = makeEventStoreRevert(adapter, registry);
  });

  afterAll(async () => {
    await adapter.close();
  });

  beforeEach(async () => {
    await adapter.reset();
    eventCounter = 0;
  });

  it('revert creates compensating events and they are persisted', async () => {
    // Register compensation: CreatedReversed undoes Created
    registry.register('test', 'Created', (event) => ({
      id: `c-${Date.now()}-${++eventCounter}`,
      domain: 'test',
      type: 'CreatedReversed',
      payload: { originalId: event.id },
      identifier: event.identifier,
      created: new Date(),
    }));

    // Append a Created event
    const createdEvent = makeEvent('test', 'Created', { data: 'hello' }, 'entity-1');
    await adapter.append([createdEvent]);

    // Revert it
    const result = await revert.revert(createdEvent.id);
    expect(result.compensatingEvents).toHaveLength(1);
    expect(result.compensatingEvents[0].type).toBe('CreatedReversed');

    // Verify compensating event is persisted in PG
    const retrieved = await adapter.getEventById(result.compensatingEvents[0].id);
    expect(retrieved).not.toBeNull();
    expect(retrieved.type).toBe('CreatedReversed');
    expect(retrieved.meta.isCompensating).toBe(true);
    expect(retrieved.meta.compensatesEventId).toBe(createdEvent.id);
  });

  it('canRevert returns true when compensation is registered', async () => {
    registry.register('test', 'Created', () => ({ type: 'Reversed', payload: {} }));

    const event = makeEvent('test', 'Created', {}, 'entity-1');
    await adapter.append([event]);

    const result = await revert.canRevert(event.id);
    expect(result.canRevert).toBe(true);
    expect(result.blockedBy).toBeUndefined();
  });

  it('canRevert returns false when compensation is NOT registered', async () => {
    // No registration for 'test'::'UnknownType'
    const event = makeEvent('test', 'UnknownType', {}, 'entity-1');
    await adapter.append([event]);

    const result = await revert.canRevert(event.id);
    expect(result.canRevert).toBe(false);
    expect(result.blockedBy).toHaveLength(1);
    expect(result.blockedBy[0].reason).toContain('No compensation registered');
  });

  it('previewRevert returns root and descendants', async () => {
    registry.register('test', 'Created', () => ({ type: 'Reversed', payload: {} }));
    registry.register('test', 'Updated', () => ({ type: 'UpdatedReversed', payload: {} }));

    const root = makeEvent('test', 'Created', {}, 'entity-1');
    await adapter.append([root]);
    await adapter.appendToStream([{ ...makeEvent('test', 'Updated', {}, 'entity-1'), causationId: root.id }], 1);

    const preview = await revert.previewRevert(root.id);
    expect(preview.rootEvent.id).toBe(root.id);
    expect(preview.descendantEvents).toHaveLength(1);
    expect(preview.descendantEvents[0].type).toBe('Updated');
  });

  it('revert throws when compensation is missing', async () => {
    // Append an event with no compensation registered
    const event = makeEvent('test', 'NoCompensation', {}, 'entity-1');
    await adapter.append([event]);

    await expect(revert.revert(event.id)).rejects.toThrow('Cannot revert: no compensation registered');
  });

  it('revert uses post-order: children compensated before parent', async () => {
    const compensationOrder = [];
    registry.register('test', 'Child', (event) => {
      compensationOrder.push('Child');
      return { domain: event.domain, type: 'ChildReversed', payload: {} };
    });
    registry.register('test', 'Parent', (event) => {
      compensationOrder.push('Parent');
      return { domain: event.domain, type: 'ParentReversed', payload: {} };
    });

    const parent = makeEvent('test', 'Parent', {}, 'entity-1');
    await adapter.append([parent]);
    await adapter.appendToStream([{ ...makeEvent('test', 'Child', {}, 'entity-1'), causationId: parent.id }], 1);

    await revert.revert(parent.id);

    // Child should be compensated before Parent (post-order)
    expect(compensationOrder).toEqual(['Child', 'Parent']);
  });

  it('compensation function can return array of events', async () => {
    registry.register('test', 'BatchCreated', (event) => [
      { domain: event.domain, type: 'Item1Removed', payload: { originalId: event.id }, identifier: event.identifier },
      { domain: event.domain, type: 'Item2Removed', payload: { originalId: event.id }, identifier: event.identifier },
    ]);

    const event = makeEvent('test', 'BatchCreated', {}, 'entity-1');
    await adapter.append([event]);

    const result = await revert.revert(event.id);
    expect(result.compensatingEvents).toHaveLength(2);
  });

  it('previewRevert returns empty descendants for event with no children', async () => {
    registry.register('test', 'Solo', () => ({ type: 'SoloReversed', domain: 'test', payload: {} }));

    const solo = makeEvent('test', 'Solo', {}, 'entity-1');
    await adapter.append([solo]);

    const preview = await revert.previewRevert(solo.id);
    expect(preview.rootEvent.id).toBe(solo.id);
    expect(preview.descendantEvents).toHaveLength(0);
  });

  it('revert single event without causation chain', async () => {
    registry.register('test', 'Single', () => ({ type: 'SingleReversed', domain: 'test', payload: {} }));

    const single = makeEvent('test', 'Single', {}, 'entity-1');
    await adapter.append([single]);

    const result = await revert.revert(single.id);
    expect(result.compensatingEvents).toHaveLength(1);
    expect(result.compensatingEvents[0].type).toBe('SingleReversed');
    expect(result.compensatingEvents[0].causationId).toBe(single.id);
  });

  it('canRevert returns false for event with no compensation registered', async () => {
    // No registration for 'test'::'UnregisteredType'
    const event = makeEvent('test', 'UnregisteredType', {}, 'entity-1');
    await adapter.append([event]);

    const result = await revert.canRevert(event.id);
    expect(result.canRevert).toBe(false);
    expect(result.blockedBy).toHaveLength(1);
    expect(result.blockedBy[0].reason).toContain('No compensation registered');
  });

  it('compensation can access original event properties', async () => {
    registry.register('test', 'AmountEvent', (event) => ({
      domain: 'test',
      type: 'AmountReversed',
      payload: { originalAmount: event.payload.amount, originalId: event.id },
    }));

    const event = makeEvent('test', 'AmountEvent', { amount: 42 }, 'entity-1');
    await adapter.append([event]);

    const result = await revert.revert(event.id);
    expect(result.compensatingEvents[0].payload.originalAmount).toBe(42);
    expect(result.compensatingEvents[0].payload.originalId).toBe(event.id);
  });

  it('previewRevert returns correct descendant count for multi-level chain', async () => {
    registry.register('test', 'Created', () => ({ type: 'CreatedReversed', domain: 'test', payload: {} }));
    registry.register('test', 'Updated', () => ({ type: 'UpdatedReversed', domain: 'test', payload: {} }));
    registry.register('test', 'Finalized', () => ({ type: 'FinalizedReversed', domain: 'test', payload: {} }));

    const root = makeEvent('test', 'Created', {}, 'entity-1');
    await adapter.append([root]);
    await adapter.appendToStream([{ ...makeEvent('test', 'Updated', {}, 'entity-1'), causationId: root.id }], 1);
    await adapter.appendToStream([{ ...makeEvent('test', 'Finalized', {}, 'entity-1'), causationId: root.id }], 2);

    const preview = await revert.previewRevert(root.id);
    expect(preview.descendantEvents).toHaveLength(2);
  });

  it('revert creates compensating events with correct correlationId', async () => {
    registry.register('test', 'Event1', () => ({ type: 'Event1Reversed', domain: 'test', payload: {} }));

    const event = makeEvent('test', 'Event1', { data: 'test' }, 'entity-1');
    await adapter.append([event]);

    const result = await revert.revert(event.id);
    expect(result.compensatingEvents[0].correlationId).toBe(event.id);
  });

  it('compensation registered for multiple event types works independently', async () => {
    registry.register('test', 'TypeA', () => ({ type: 'TypeAReversed', domain: 'test', payload: {} }));
    registry.register('test', 'TypeB', () => ({ type: 'TypeBReversed', domain: 'test', payload: {} }));

    const eventA = makeEvent('test', 'TypeA', {}, 'entity-1');
    const eventB = makeEvent('test', 'TypeB', {}, 'entity-2');
    await adapter.append([eventA, eventB]);

    const resultA = await revert.revert(eventA.id);
    const resultB = await revert.revert(eventB.id);

    expect(resultA.compensatingEvents[0].type).toBe('TypeAReversed');
    expect(resultB.compensatingEvents[0].type).toBe('TypeBReversed');
  });

  it('previewRevert returns root event with correct properties', async () => {
    registry.register('test', 'Preview', () => ({ type: 'PreviewReversed', domain: 'test', payload: {} }));

    const event = makeEvent('test', 'Preview', { preview: true }, 'entity-1');
    await adapter.append([event]);

    const preview = await revert.previewRevert(event.id);
    expect(preview.rootEvent.id).toBe(event.id);
    expect(preview.rootEvent.type).toBe('Preview');
    expect(preview.rootEvent.payload.preview).toBe(true);
  });

  it('revert can be called multiple times on different events', async () => {
    registry.register('test', 'MultiRevert', () => ({ type: 'MultiRevertReversed', domain: 'test', payload: {} }));

    const event1 = makeEvent('test', 'MultiRevert', {}, 'entity-1');
    const event2 = makeEvent('test', 'MultiRevert', {}, 'entity-2');
    await adapter.append([event1, event2]);

    const result1 = await revert.revert(event1.id);
    const result2 = await revert.revert(event2.id);

    expect(result1.compensatingEvents).toHaveLength(1);
    expect(result2.compensatingEvents).toHaveLength(1);
  });

  it('compensation returns event with identifier from original', async () => {
    registry.register('test', 'Identified', (e) => ({
      type: 'IdentifiedReversed',
      domain: 'test',
      payload: {},
      identifier: e.identifier,
    }));

    const event = makeEvent('test', 'Identified', {}, 'specific-entity');
    await adapter.append([event]);

    const result = await revert.revert(event.id);
    expect(result.compensatingEvents[0].identifier).toBe('specific-entity');
  });

  it('previewRevert and revert are consistent', async () => {
    registry.register('test', 'Consistent', () => ({ type: 'ConsistentReversed', domain: 'test', payload: {} }));

    const event = makeEvent('test', 'Consistent', {}, 'entity-1');
    await adapter.append([event]);

    const preview = await revert.previewRevert(event.id);
    const revertResult = await revert.revert(event.id);

    expect(preview.rootEvent.id).toBe(revertResult.compensatingEvents[0].causationId);
  });

  it('compensating event created timestamp is recent', async () => {
    registry.register('test', 'Timestamp', () => ({ type: 'TimestampReversed', domain: 'test', payload: {} }));

    const before = Date.now();
    const event = makeEvent('test', 'Timestamp', {}, 'entity-1');
    await adapter.append([event]);

    const result = await revert.revert(event.id);
    const after = Date.now();

    const compCreated = result.compensatingEvents[0].created.getTime();
    expect(compCreated).toBeGreaterThanOrEqual(before);
    expect(compCreated).toBeLessThanOrEqual(after + 1000);
  });

  it('canRevert returns true for event with compensation', async () => {
    registry.register('test', 'CanRevert', () => ({ type: 'CanRevertReversed', domain: 'test', payload: {} }));

    const event = makeEvent('test', 'CanRevert', {}, 'entity-1');
    await adapter.append([event]);

    const result = await revert.canRevert(event.id);
    expect(result.canRevert).toBe(true);
  });

  it('previewRevert does not modify database', async () => {
    registry.register('test', 'Preview', () => ({ type: 'PreviewReversed', domain: 'test', payload: {} }));

    const event = makeEvent('test', 'Preview', {}, 'entity-1');
    await adapter.append([event]);

    const countBefore = (await adapter.getAllEvents(100)).length;

    await revert.previewRevert(event.id);

    const countAfter = (await adapter.getAllEvents(100)).length;
    expect(countAfter).toBe(countBefore);
  });

  it('revert compensates events in post-order regardless of creation order', async () => {
    const order = [];
    registry.register('test', 'Parent', () => {
      order.push('Parent');
      return { type: 'ParentReversed', domain: 'test', payload: {} };
    });
    registry.register('test', 'Child', () => {
      order.push('Child');
      return { type: 'ChildReversed', domain: 'test', payload: {} };
    });

    const parent = makeEvent('test', 'Parent', {}, 'entity-1');
    await adapter.append([parent]);
    await adapter.appendToStream([{ ...makeEvent('test', 'Child', {}, 'entity-1'), causationId: parent.id }], 1);

    await revert.revert(parent.id);

    expect(order).toEqual(['Child', 'Parent']);
  });

  it('compensation event has created timestamp set', async () => {
    registry.register('test', 'CreatedTs', () => ({ type: 'CreatedTsReversed', domain: 'test', payload: {} }));

    const event = makeEvent('test', 'CreatedTs', {}, 'entity-1');
    await adapter.append([event]);

    const result = await revert.revert(event.id);
    expect(result.compensatingEvents[0].created instanceof Date).toBe(true);
  });
});
