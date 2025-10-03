import { EventStore } from '../EventStore.types';
import { combineLatest, interval, lastValueFrom } from 'rxjs';
import * as Rx from 'rxjs/operators';
import { completeOn } from './completeOn.operator';

export const sideEffectFinishedPromise = (eventStore: EventStore) =>
  lastValueFrom(
    combineLatest<[number, number | null]>([interval(100), eventStore.sideEffectQueue.queueInstance.queueSize$]).pipe(
      Rx.map(([_, num]) => num),
      completeOn()
    )
  );
