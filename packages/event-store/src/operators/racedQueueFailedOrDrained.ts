import { ApplyQueue } from '../queue/RxQueue';
import { Observable, race } from 'rxjs';
import { EventTaskAndError } from '../EventStore.types';
import * as Rx from 'rxjs/operators';

export const racedQueueFailedOrDrained = (applyQueue: ApplyQueue): Observable<EventTaskAndError> =>
  race([applyQueue.drained$, applyQueue.taskFailed$]).pipe(
    Rx.map(([queue, taskId, taskAndError]) => taskAndError as EventTaskAndError)
  );
