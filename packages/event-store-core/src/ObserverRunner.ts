import type { Observer, PersistedEvent } from './types';

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

export async function runObservers(events: PersistedEvent[], observers: Observer[]): Promise<void> {
  if (observers.length === 0) return;

  const observerMap = buildObserverMap(observers);
  for (const event of events) {
    const matching = observerMap[`${event.domain}__${event.type}`];
    if (!matching?.length) continue;

    const sorted = [...matching].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    for (const observer of sorted) {
      const run = () => observer.apply(event);
      if (observer.fireAndForget) {
        Promise.resolve(run()).catch(() => {});
      } else {
        await run();
      }
    }
  }
}
