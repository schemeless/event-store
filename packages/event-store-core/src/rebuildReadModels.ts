import type { EventStoreCoreRepo, Observer } from './types';
import { runObservers } from './ObserverRunner';

export interface RebuildReadModelsOptions {
  startFromId?: string;
  observers?: Observer[];
  reset?: () => Promise<void>;
  pageSize?: number;
}

export async function rebuildReadModels(
  repo: EventStoreCoreRepo,
  options: RebuildReadModelsOptions = {}
): Promise<void> {
  const { startFromId, observers = [], reset, pageSize = 200 } = options;
  if (reset) await reset();
  const iterator = await repo.getAllEvents(pageSize, startFromId);
  for await (const page of iterator) {
    if (page.length === 0) break;
    await runObservers(page, observers, { mode: 'rebuild' });
  }
}
