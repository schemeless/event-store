import { BaseEvent, CreatedEvent, EventFlowMap } from '../EventStore.types';
import * as uuid from 'uuid/v4';

export const getEventKey = (event: BaseEvent<any>) => event.domain + '__' + event.type;

export const getEventFlow = (eventFlowMap: EventFlowMap, eventPayloadArgs: BaseEvent<any>) => {
  const key = getEventKey(eventPayloadArgs);
  return eventFlowMap[key];
};

export function defaultEventCreator<Payload>(
  eventArgs: BaseEvent<Payload>,
  causalEvent?: CreatedEvent<any>
): CreatedEvent<Payload> {
  const thisTrackingId = eventArgs.trackingId || uuid();
  return {
    ...eventArgs,

    trackingId: thisTrackingId,
    causationId: eventArgs.causationId || causalEvent ? causalEvent.trackingId : undefined,
    correlationId:
      eventArgs.correlationId || (causalEvent ? causalEvent.correlationId || causalEvent.trackingId : thisTrackingId),
    identifier: eventArgs.identifier || (causalEvent ? causalEvent.identifier : undefined),

    created: new Date()
  };
}
