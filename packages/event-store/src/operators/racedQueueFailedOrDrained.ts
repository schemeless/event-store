import { ApplyQueue } from '../queue/RxQueue';
import { Observable, of, race } from 'rxjs';
import { EventTaskAndError } from '@schemeless/event-store-types';
import * as Rx from 'rxjs/operators';
import { isEventTaskError } from './isEventTaskError';

export const racedQueueFailedOrDrained = (applyQueue: ApplyQueue): Observable<EventTaskAndError | null> =>
  race([applyQueue.drained$, applyQueue.taskFailed$.pipe(Rx.catchError((err) => of(err)))]).pipe(
    Rx.map((_) => (isEventTaskError(_) ? (_ as EventTaskAndError) : null))
  );
