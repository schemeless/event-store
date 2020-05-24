import { pipe } from 'rxjs';
import * as Rx from 'rxjs/operators';
import { logEvent } from '../util/logEvent';
import { Job } from 'bull';
import { CreatedEvent } from '../EventStore.types';
import { EventQueueType } from '../queue/EventQueue';

export const discardFailedEvent = pipe(
  Rx.tap<[EventQueueType, Job<CreatedEvent<any>>, Error]>(([queue, job]) => {
    logEvent(job.data, '♻️', 'discard');
    job.discard();
  })
);
