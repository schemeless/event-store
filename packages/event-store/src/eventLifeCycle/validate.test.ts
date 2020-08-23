import { validate } from './validate';
import { StandardEvent } from '../mockEvents';
import { defaultEventCreator } from '../operators/defaultEventCreator';

describe('validateEvent', () => {
  it('should throw an error on invalid', () => {
    const event = defaultEventCreator({
      domain: StandardEvent.domain,
      type: StandardEvent.type,
      payload: { key: 'validateEvent1', positiveNumber: -1 }
    });
    expect(validate(StandardEvent, event)).rejects.toThrow(/Invalid positive number/);
  });

  it('should not throw an error on valid', () => {
    const event = defaultEventCreator({
      domain: StandardEvent.domain,
      type: StandardEvent.type,
      payload: { key: 'validateEvent2', positiveNumber: 1 }
    });
    expect(() => validate(StandardEvent, event)).not.toThrow();
  });
});
