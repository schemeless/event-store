import type { Observable } from 'rxjs';
import type {
  CreatedEvent,
  EventObserverState,
  EventOutputState,
  IEventStoreRepo,
  SideEffectsState,
} from '@schemeless/event-store-types';

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
  eventStoreRepo: IEventStoreRepo;
  output$: Observable<EventOutput>;
}

export * from '@schemeless/event-store-types';
