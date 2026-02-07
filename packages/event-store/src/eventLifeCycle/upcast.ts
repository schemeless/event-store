import type { CreatedEvent, EventFlow } from '@schemeless/event-store-types';
import { logEvent } from '../util/logEvent';

const DEFAULT_VERSION = 1;

export const upcast = async (
    eventFlow: EventFlow<any>,
    event: CreatedEvent<any, any>
): Promise<CreatedEvent<any, any>> => {
    if (!eventFlow.upcast) return event;

    const fromVersion = event.meta?.schemaVersion ?? DEFAULT_VERSION;
    const targetVersion = eventFlow.schemaVersion ?? DEFAULT_VERSION;

    // Already at latest version
    if (fromVersion >= targetVersion) return event;

    logEvent(event, '⬆️', `Upcast v${fromVersion} → v${targetVersion}`);
    const upcastedEvent = await eventFlow.upcast(event, fromVersion);

    if (!upcastedEvent) return event;

    // Ensure schemaVersion is updated in meta
    return {
        ...upcastedEvent,
        meta: { ...(upcastedEvent.meta || {}), schemaVersion: targetVersion },
    };
};
