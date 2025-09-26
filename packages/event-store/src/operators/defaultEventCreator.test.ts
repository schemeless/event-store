import { defaultEventCreator } from './defaultEventCreator';

describe('defaultEventCreator', () => {
  it('uses provided causationId when no causal event is supplied', () => {
    const event = defaultEventCreator({
      domain: 'Test',
      type: 'TestEvent',
      payload: { value: 1 },
      causationId: 'manual-id',
    });

    expect(event.causationId).toBe('manual-id');
  });
});
