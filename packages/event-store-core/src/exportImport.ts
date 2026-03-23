import type { EventStoreCoreRepo, PersistedEvent } from './types';

export interface ExportOptions {
  pageSize?: number;
}

export interface ImportOptions {
  replace?: boolean;
}

export function exportEvents(repo: EventStoreCoreRepo, options: ExportOptions = {}): AsyncIterable<PersistedEvent[]> {
  const { pageSize = 200 } = options;
  return (async function* () {
    const iterator = await repo.getAllEvents(pageSize);
    for await (const page of iterator) {
      if (page.length === 0) break;
      yield page;
    }
  })();
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
