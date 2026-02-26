import type { IEventStoreEntity, IEventStoreRepo } from '@schemeless/event-store-types';

export interface ExportEventsOptions {
  /**
   * Number of events to fetch per page during export.
   * @default 200
   */
  pageSize?: number;

  /**
   * Optional progress callback called after each page is fetched.
   * Useful for showing progress in a UI.
   * @param fetched - Number of events fetched so far
   */
  onProgress?: (fetched: number) => void;
}

export interface ImportEventsOptions {
  /**
   * Number of events to write per batch.
   * @default 100
   */
  batchSize?: number;

  /**
   * If true, clears the store with `resetStore()` before importing.
   * @default false
   */
  replace?: boolean;

  /**
   * Optional progress callback called after each batch is written.
   * @param written - Number of events written so far
   */
  onProgress?: (written: number) => void;
}

/**
 * Exports all events from an event store into a plain array suitable for
 * JSON serialization (e.g. writing to a file for backup or analysis).
 *
 * @example
 * ```ts
 * // React Native + Expo
 * import { exportEventsToArray } from '@schemeless/event-store';
 * import * as FileSystem from 'expo-file-system';
 *
 * const events = await exportEventsToArray(myEventStore.eventStoreRepo);
 * const json = JSON.stringify(events, null, 2);
 * await FileSystem.writeAsStringAsync(
 *   FileSystem.documentDirectory + 'backup.json',
 *   json
 * );
 * ```
 */
export async function exportEventsToArray(
  repo: IEventStoreRepo,
  options: ExportEventsOptions = {}
): Promise<IEventStoreEntity[]> {
  const { pageSize = 200, onProgress } = options;
  const allEvents: IEventStoreEntity[] = [];

  const iterator = await repo.getAllEvents(pageSize);
  for await (const page of iterator) {
    if (page.length === 0) break;
    allEvents.push(...page);
    onProgress?.(allEvents.length);
  }

  return allEvents;
}

/**
 * Serializable representation of an event store snapshot.
 * Safe to pass through `JSON.stringify` / `JSON.parse`.
 */
export interface EventStoreSnapshot {
  /** ISO-8601 timestamp of when the snapshot was created */
  exportedAt: string;
  /** Total number of events included */
  count: number;
  /** The raw events */
  events: IEventStoreEntity[];
}

/**
 * Wraps the exported events into a snapshot object that includes metadata.
 * Use `JSON.stringify(snapshot)` to serialise it.
 */
export function createSnapshot(events: IEventStoreEntity[]): EventStoreSnapshot {
  return {
    exportedAt: new Date().toISOString(),
    count: events.length,
    events,
  };
}

/**
 * Parses a snapshot that was previously serialised with `JSON.stringify`.
 * Restores `Date` objects for the `created` field on every event.
 */
export function parseSnapshot(json: string): EventStoreSnapshot {
  const raw: EventStoreSnapshot = JSON.parse(json);
  raw.events = raw.events.map((e) => ({
    ...e,
    created: new Date(e.created),
  }));
  return raw;
}

/**
 * Imports events from a plain array into the event store repo, writing them
 * in batches.  Date strings are automatically converted to `Date` objects.
 *
 * @example
 * ```ts
 * // React Native + Expo — restore from backup
 * import { importEventsFromArray, parseSnapshot } from '@schemeless/event-store';
 * import * as FileSystem from 'expo-file-system';
 *
 * const json = await FileSystem.readAsStringAsync(backupPath);
 * const snapshot = parseSnapshot(json);
 * await importEventsFromArray(myEventStore.eventStoreRepo, snapshot.events, { replace: true });
 * ```
 */
export async function importEventsFromArray(
  repo: IEventStoreRepo,
  events: IEventStoreEntity[],
  options: ImportEventsOptions = {}
): Promise<void> {
  const { batchSize = 100, replace = false, onProgress } = options;

  if (replace) {
    await repo.resetStore();
  }

  // Ensure `created` fields are proper Date instances regardless of whether
  // they came from JSON (string) or were already Date objects.
  const normalised = events.map((e) => ({
    ...e,
    created: new Date(e.created),
  }));

  let written = 0;
  for (let i = 0; i < normalised.length; i += batchSize) {
    const batch = normalised.slice(i, i + batchSize);
    // storeEvents expects CreatedEvent[], which is structurally compatible
    // with IEventStoreEntity[] — both have id, domain, type, payload, created.
    await repo.storeEvents(batch as any[]);
    written += batch.length;
    onProgress?.(written);
  }
}
