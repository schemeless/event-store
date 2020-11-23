import type { Observable } from 'rxjs';
import { CreatedEvent, EventObserverState, EventOutputState, SideEffectsState } from '@schemeless/event-store-types';

import { makeMainQueue } from './queue/makeMainQueue';
import { makeReceive } from './queue/makeReceive';
import { makeReplay } from './makeReplay';

export interface EventOutput<Payload = any> {
  state: SideEffectsState | EventOutputState | EventObserverState;
  error?: Error;
  event: CreatedEvent<Payload>;
}

export interface EventStore {
  mainQueue: ReturnType<typeof makeMainQueue>;
  receive: ReturnType<typeof makeReceive>;
  replay: ReturnType<typeof makeReplay>;
  output$: Observable<EventOutput>;
}
