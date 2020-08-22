import { ApplyQueue } from '../queue/RxQueue';
import { Observable, of, race } from 'rxjs';
import { EventTaskAndError } from '../EventStore.types';
import * as Rx from 'rxjs/operators';

export const racedQueueFailedOrDrained = (applyQueue: ApplyQueue): Observable<EventTaskAndError> =>
  race([applyQueue.drained$, applyQueue.taskFailed$.pipe(Rx.catchError(err => of(err)))]).pipe(
    Rx.map(_ => {
      return _ as EventTaskAndError;
    })
  );
