import { processEventTree, AggregateLoader } from './processEventTree';
import type { BaseEvent, EventFlowMap, EventFlow, AggregateEventFlow } from '@schemeless/event-store-types';
import { defaultEventCreator } from '../operators/defaultEventCreator';

describe('processEventTree', () => {
  const mockSimpleFlow = {
    kind: 'simple',
    domain: 'test',
    type: 'simple',
    apply: jest.fn().mockResolvedValue(undefined),
    validate: jest.fn().mockResolvedValue(undefined),
    receive: jest.fn() as any,
  } as unknown as EventFlow<any>;

  const mockPreApplyFlow = {
    kind: 'simple',
    domain: 'test',
    type: 'preApplyMock',
    preApply: jest.fn().mockImplementation((event) => {
      return { ...event, payload: { ...event.payload, modified: true } };
    }),
    apply: jest.fn().mockResolvedValue(undefined),
    receive: jest.fn() as any,
  } as unknown as EventFlow<any>;

  const mockUpcastFlow = {
    kind: 'simple',
    domain: 'test',
    type: 'upcastMock',
    schemaVersion: 2,
    upcast: jest.fn().mockImplementation((event) => {
      return { ...event, payload: { ...event.payload, upcasted: true } };
    }),
    apply: jest.fn().mockResolvedValue(undefined),
    receive: jest.fn() as any,
  } as unknown as EventFlow<any>;

  const mockAggregateFlow = {
    kind: 'aggregate',
    domain: 'test',
    type: 'aggregate',
    aggregate: {
      getIdentifier: (e: any) => e.identifier || 'default-id',
      reducer: (state: any, e: any) => state,
      initialState: { count: 0 },
    },
    validate: jest.fn().mockResolvedValue(undefined),
    apply: jest.fn().mockImplementation((event, state) => {
      return { count: state.count + 1 };
    }),
    receive: jest.fn() as any,
  } as unknown as AggregateEventFlow<any, any>;

  const mockConsequentFlow = {
    kind: 'simple',
    domain: 'test',
    type: 'consequentParent',
    apply: jest.fn().mockResolvedValue(undefined),
    createConsequentEvents: jest.fn().mockImplementation((event) => {
      return [
        { domain: 'test', type: 'simple', payload: { id: 1 }, identifier: '1' },
        { domain: 'test', type: 'simple', payload: { id: 2 }, identifier: '2' },
      ];
    }),
    receive: jest.fn() as any,
  } as unknown as EventFlow<any>;

  const mockCircularFlow = {
    kind: 'simple',
    domain: 'test',
    type: 'circular',
    apply: jest.fn().mockResolvedValue(undefined),
    createConsequentEvents: jest.fn().mockImplementation((event) => {
      return [
        { domain: 'test', type: 'circular', payload: {} }
      ];
    }),
    receive: jest.fn() as any,
  } as unknown as EventFlow<any>;

  const eventFlowMap: EventFlowMap = {
    'test__simple': mockSimpleFlow as any,
    'test__aggregate': mockAggregateFlow as any,
    'test__consequentParent': mockConsequentFlow as any,
    'test__circular': mockCircularFlow as any,
    'test__preApplyMock': mockPreApplyFlow as any,
    'test__upcastMock': mockUpcastFlow as any,
  };

  const mockGetAggregate = jest.fn().mockResolvedValue({ state: { count: 0 }, sequence: 0 }) as jest.MockedFunction<AggregateLoader>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('simple event: no aggregate, no consequents', async () => {
    const input: BaseEvent<any> = { domain: 'test', type: 'simple', payload: {} };
    const result = await processEventTree(input, eventFlowMap, undefined);
    
    expect(result.events).toHaveLength(1);
    expect(result.events[0].event.domain).toBe('test');
    expect(result.events[0].event.type).toBe('simple');
    expect(result.events[0].aggregateState).toBeUndefined();
    
    expect(mockSimpleFlow.validate).toHaveBeenCalledTimes(1);
    expect(mockSimpleFlow.apply).toHaveBeenCalledTimes(1);
  });

  it('aggregate event: state loaded, returned in result', async () => {
    const input: BaseEvent<any> = { domain: 'test', type: 'aggregate', payload: {}, identifier: 'agg-1' };
    const result = await processEventTree(input, eventFlowMap, mockGetAggregate);
    
    expect(result.events).toHaveLength(1);
    expect(result.events[0].aggregateState).toEqual({ count: 1 });
    expect(result.events[0].aggregateDomain).toBe('test');
    expect(result.events[0].aggregateIdentifier).toBe('agg-1');
    
    expect(mockGetAggregate).toHaveBeenCalledTimes(1);
    expect(mockGetAggregate).toHaveBeenCalledWith('test', 'agg-1', mockAggregateFlow.aggregate.reducer, { count: 0 });
    
    expect(mockAggregateFlow.validate).toHaveBeenCalledTimes(1);
    expect(mockAggregateFlow.apply).toHaveBeenCalledTimes(1);
  });

  it('consequent events: depth-first order', async () => {
    const input: BaseEvent<any> = { domain: 'test', type: 'consequentParent', payload: {} };
    const result = await processEventTree(input, eventFlowMap, undefined);
    
    expect(result.events).toHaveLength(3);
    
    // Parent applied first
    expect(result.events[0].event.type).toBe('consequentParent');
    expect(result.events[1].event.type).toBe('simple');
    expect(result.events[1].event.payload).toEqual({ id: 1 });
    expect(result.events[2].event.type).toBe('simple');
    expect(result.events[2].event.payload).toEqual({ id: 2 });
    
    expect(mockConsequentFlow.createConsequentEvents).toHaveBeenCalledTimes(1);
    expect(mockSimpleFlow.apply).toHaveBeenCalledTimes(2);
  });

  it('depth limit exceeded throws', async () => {
    const input: BaseEvent<any> = { domain: 'test', type: 'circular', payload: {} };
    await expect(processEventTree(input, eventFlowMap, undefined, { maxDepth: 5 }))
      .rejects.toThrow(/Event tree exceeded max depth 5/);
  });

  it('aggregate state reuse across events in same tree', async () => {
    const mockDoubleAggregateParent = {
      kind: 'simple',
      domain: 'test',
      type: 'doubleAgg',
      apply: jest.fn().mockResolvedValue(undefined),
      createConsequentEvents: jest.fn().mockReturnValue([
        { domain: 'test', type: 'aggregate', payload: {}, identifier: 'agg-shared' },
        { domain: 'test', type: 'aggregate', payload: {}, identifier: 'agg-shared' },
      ]),
      receive: jest.fn() as any,
    } as unknown as EventFlow<any>;
    const map = { ...eventFlowMap, 'test__doubleAgg': mockDoubleAggregateParent as any };
    
    const input: BaseEvent<any> = { domain: 'test', type: 'doubleAgg', payload: {} };
    const result = await processEventTree(input, map, mockGetAggregate);
    
    expect(result.events).toHaveLength(3);
    // Parent
    expect(result.events[0].event.type).toBe('doubleAgg');
    // First consequent
    expect(result.events[1].event.type).toBe('aggregate');
    expect(result.events[1].aggregateState).toEqual({ count: 1 });
    // Second consequent - should reuse state from first passing, making it 2
    expect(result.events[2].event.type).toBe('aggregate');
    expect(result.events[2].aggregateState).toEqual({ count: 2 });
    
    expect(mockGetAggregate).toHaveBeenCalledTimes(1);
  });

  it('validation failure throws and stops processing', async () => {
    const mockFailingSimpleFlow = {
      ...mockSimpleFlow,
      validate: jest.fn().mockRejectedValue(new Error('Validation failed')),
      apply: jest.fn().mockResolvedValue(undefined),
    } as unknown as EventFlow<any>;
    
    const map = { ...eventFlowMap, 'test__simple': mockFailingSimpleFlow as any };
    
    const input: BaseEvent<any> = { domain: 'test', type: 'simple', payload: {} };
    
    await expect(processEventTree(input, map, undefined))
      .rejects.toThrow('Validation failed');
      
    expect(mockFailingSimpleFlow.apply).not.toHaveBeenCalled();
  });

  it('preApply transforms event', async () => {
    const input: BaseEvent<any> = { domain: 'test', type: 'preApplyMock', payload: {} };
    const result = await processEventTree(input, eventFlowMap, undefined);
    
    expect(result.events).toHaveLength(1);
    expect(result.events[0].event.payload).toEqual({ modified: true });
    
    expect(mockPreApplyFlow.preApply).toHaveBeenCalledTimes(1);
    expect(mockPreApplyFlow.apply).toHaveBeenCalledTimes(1);
  });

  it('upcast is called for old schema versions', async () => {
    const eventInput: BaseEvent<any> = { domain: 'test', type: 'upcastMock', payload: {}, meta: { schemaVersion: 1 } };
    const result = await processEventTree(eventInput, eventFlowMap, undefined);
    
    expect(mockUpcastFlow.upcast).toHaveBeenCalledTimes(1);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].event.payload).toEqual({ upcasted: true });
  });
});
