import { validateEvent } from './validateEvent';
import { StandardEvent } from '../mockEvents';
import { defaultEventCreator } from './defaultEventCreator';

describe('validateEvent', () => {
  it('should throw an error on invalid', () => {
    const event = defaultEventCreator({
      domain: StandardEvent.domain,
      type: StandardEvent.type,
      payload: { positiveNumber: -1 }
    });
    expect(validateEvent(StandardEvent, event)).rejects.toThrow(/Invalid positive number/);
  });

  it('should not throw an error on valid', () => {
    const event = defaultEventCreator({
      domain: StandardEvent.domain,
      type: StandardEvent.type,
      payload: { positiveNumber: 1 }
    });
    expect(() => validateEvent(StandardEvent, event)).not.toThrow();
  });
});
