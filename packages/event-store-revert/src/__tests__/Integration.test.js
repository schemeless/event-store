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
    registry.register('test', 'Child', () => {
      compensationOrder.push('Child');
      return { type: 'ChildReversed', payload: {} };
    });
    registry.register('test', 'Parent', () => {
      compensationOrder.push('Parent');
      return { type: 'ParentReversed', payload: {} };
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
      { type: 'Item1Removed', payload: { originalId: event.id }, identifier: event.identifier },
      { type: 'Item2Removed', payload: { originalId: event.id }, identifier: event.identifier },
    ]);

    const event = makeEvent('test', 'BatchCreated', {}, 'entity-1');
    await adapter.append([event]);

    const result = await revert.revert(event.id);
    expect(result.compensatingEvents).toHaveLength(2);
  });
});
