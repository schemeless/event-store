import type { EventStoreCore, EventStoreCoreRepo } from './types';
import { exportEvents, importEvents } from './exportImport';
import { rebuildReadModels } from './rebuildReadModels';

export const makeEventStoreCore = (repo: EventStoreCoreRepo): EventStoreCore => ({
  append: async (events) => {
    await repo.append(events);
  },
  stream: async (domain, identifier, options = {}) => {
    if (repo.getStreamEvents) {
      return repo.getStreamEvents(domain, identifier, options.fromSequence ?? 0);
    }
    const pages = await repo.getAllEvents(200);
    const events: any[] = [];
    for await (const page of pages) {
      for (const event of page) {
        if (event.domain === domain && event.identifier === identifier) {
          if ((event.sequence ?? 0) > (options.fromSequence ?? 0)) events.push(event);
        }
      }
    }
    return events;
  },
  scan: (options = {}) => {
    return (async function* () {
      const iterator = await repo.getAllEvents(options.pageSize ?? 200, options.startFromId);
      for await (const page of iterator) {
        if (page.length === 0) break;
        yield page;
      }
    })();
  },
  rebuildReadModels: async (options = {}) => {
    await rebuildReadModels(repo, options);
  },
  export: (options = {}) => exportEvents(repo, options),
  import: async (events, options = {}) => importEvents(repo, events, options),
});
