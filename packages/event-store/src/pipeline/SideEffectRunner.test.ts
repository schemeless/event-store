import { runSideEffects } from './SideEffectRunner';
import type { CreatedEvent, EventFlowMap, EventFlow } from '@schemeless/event-store-types';
import { logger } from '../util/logger';

jest.mock('../util/logger');

describe('SideEffectRunner', () => {
  const mockSideEffectFn = jest.fn();

  const mockFlowWithSideEffect = {
    kind: 'simple',
    domain: 'test',
    type: 'withSE',
    sideEffect: mockSideEffectFn,
    receive: jest.fn() as any,
  } as unknown as EventFlow<any>;

  const mockFlowNoSideEffect = {
    kind: 'simple',
    domain: 'test',
    type: 'noSE',
    receive: jest.fn() as any,
  } as unknown as EventFlow<any>;

  const mockFlowWithRetry = {
    kind: 'simple',
    domain: 'test',
    type: 'withRetry',
    meta: { sideEffectFailedRetryAllowed: 2 },
    sideEffect: mockSideEffectFn,
    receive: jest.fn() as any,
  } as unknown as EventFlow<any>;

  const eventFlowMap: EventFlowMap = {
    'test__withSE': mockFlowWithSideEffect as any,
    'test__noSE': mockFlowNoSideEffect as any,
    'test__withRetry': mockFlowWithRetry as any,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('side effect runs and returns new events', async () => {
    mockSideEffectFn.mockResolvedValue([{ domain: 'test', type: 'new1' }]);

    const event: CreatedEvent<any> = { domain: 'test', type: 'withSE', payload: {}, identifier: '1', id: '1', created: new Date() } as CreatedEvent<any>;
    const result = await runSideEffects([event], eventFlowMap);

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('done');
    expect(result[0].newEvents).toHaveLength(1);
    expect(mockSideEffectFn).toHaveBeenCalledTimes(1);
  });

  it('no side effect skips gracefully', async () => {
    const event: CreatedEvent<any> = { domain: 'test', type: 'noSE', payload: {}, identifier: '1', id: '1', created: new Date() } as CreatedEvent<any>;
    const result = await runSideEffects([event], eventFlowMap);

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('no_side_effect');
    expect(result[0].newEvents).toHaveLength(0);
    expect(mockSideEffectFn).not.toHaveBeenCalled();
  });

  it('retry on failure (respects sideEffectFailedRetryAllowed)', async () => {
    mockSideEffectFn
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValueOnce([{ domain: 'test', type: 'new1' }]);
      
    // allowed 2 retries (so 3 total attempts)
    const event: CreatedEvent<any> = { domain: 'test', type: 'withRetry', payload: {}, identifier: '1', id: '1', created: new Date() } as CreatedEvent<any>;
    const result = await runSideEffects([event], eventFlowMap);

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('done');
    expect(result[0].newEvents).toHaveLength(1);
    expect(mockSideEffectFn).toHaveBeenCalledTimes(3);
  });

  it('all retries exhausted - no throw, just logged', async () => {
    mockSideEffectFn.mockRejectedValue(new Error('Persistent failure'));
      
    // allowed 2 retries (so 3 total attempts)
    const event: CreatedEvent<any> = { domain: 'test', type: 'withRetry', payload: {}, identifier: '1', id: '1', created: new Date() } as CreatedEvent<any>;
    const result = await runSideEffects([event], eventFlowMap);

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('done'); // still done, non-fatal
    expect(result[0].newEvents).toHaveLength(0);
    expect(mockSideEffectFn).toHaveBeenCalledTimes(3);
    
    // Check if error was logged
    expect(logger.error).toHaveBeenCalled();
  });
});
