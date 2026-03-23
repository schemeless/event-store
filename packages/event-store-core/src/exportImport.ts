import type { EventStoreCoreRepo, PersistedEvent } from './types';

export interface ExportOptions {
  pageSize?: number;
}

export interface ImportOptions {
  replace?: boolean;
}

export async function exportEvents(repo: EventStoreCoreRepo, options: ExportOptions = {}): Promise<PersistedEvent[]> {
  const { pageSize = 200 } = options;
  const allEvents: PersistedEvent[] = [];
  const iterator = await repo.getAllEvents(pageSize);

  for await (const page of iterator) {
    if (page.length === 0) break;
    allEvents.push(...page);
  }

  return allEvents;
}

export async function importEvents(
  repo: EventStoreCoreRepo,
  events: PersistedEvent[],
  options: ImportOptions = {}
): Promise<void> {
  if (options.replace) {
    if (!repo.reset) {
      throw new Error('replace=true requires repo.reset() support');
    }
    await repo.reset();
  }
  const normalised = events.map((event) => ({
    ...event,
    created: new Date(event.created),
  }));
  await repo.append(normalised);
}
