import type { Observer, PersistedEvent } from './types';

export interface RunObserverOptions {
  mode?: 'rebuild' | 'live';
}

const buildObserverMap = (observers: Observer[]) => {
  const map: Record<string, Observer[]> = {};
  for (const observer of observers) {
    for (const filter of observer.filters) {
      const key = `${filter.domain}__${filter.type}`;
      (map[key] ||= []).push(observer);
    }
  }
  return map;
};

export async function runObservers(
  events: PersistedEvent[],
  observers: Observer[],
  options: RunObserverOptions = {}
): Promise<void> {
  if (observers.length === 0) return;

  const mode = options.mode ?? 'live';
  const observerMap = buildObserverMap(observers);
  for (const event of events) {
    const matching = observerMap[`${event.domain}__${event.type}`];
    if (!matching?.length) continue;

    const sorted = [...matching].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    for (const observer of sorted) {
      const run = () => observer.apply(event);
      if (observer.fireAndForget && mode === 'live') {
        Promise.resolve(run()).catch((err) => {
          if (observer.onError) {
            observer.onError(err, event);
          } else {
            console.error(`[ObserverRunner] Observer "${observer.name}" failed on event "${event.id}":`, err);
          }
        });
      } else {
        await run();
      }
    }
  }
}
