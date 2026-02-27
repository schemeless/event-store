import { defaultEventCreator } from '../operators/defaultEventCreator';
import { getEventFlow } from '../operators/getEventFlow';
import type {
  BaseEvent,
  CanRevertResult,
  CreatedEvent,
  EventFlow,
  EventFlowMap,
  IEventStoreEntity,
  IEventStoreRepo,
  PreviewRevertResult,
  RevertResult,
} from '@schemeless/event-store-types';

export interface MakeRevertDeps {
  repo: IEventStoreRepo;
  eventFlowMap: EventFlowMap;
  storeEvents: (events: CreatedEvent<any>[]) => Promise<void>;
}

/**
 * Creates the revert functions for an EventStore instance.
 * These functions allow reverting root events and all their descendants.
 */
export const makeRevert = ({ repo, eventFlowMap, storeEvents }: MakeRevertDeps) => {
  /**
   * Checks if the repository supports revert operations.
   */
  const checkRepoSupport = (): void => {
    if (!repo.getEventById || !repo.findByCausationId) {
      throw new Error(
        'Revert operations require repository to implement getEventById and findByCausationId methods. ' +
          'Please update your event store adapter to the latest version.'
      );
    }
  };

  /**
   * Recursively collects all events in the tree rooted at the given event.
   */
  const collectEventTree = async (event: CreatedEvent<any>): Promise<CreatedEvent<any>[]> => {
    const children = (await repo.findByCausationId!(event.id)) as CreatedEvent<any>[];
    const descendants: CreatedEvent<any>[] = [];

    for (const child of children) {
      descendants.push(child);
      const childDescendants = await collectEventTree(child);
      descendants.push(...childDescendants);
    }

    return descendants;
  };

  /**
   * Transforms BaseEvents from compensate() into fully-qualified CreatedEvents.
   */
  const materializeCompensatingEvents = (
    baseEvents: BaseEvent<any> | BaseEvent<any>[],
    originalEvent: CreatedEvent<any>
  ): CreatedEvent<any>[] => {
    const events = Array.isArray(baseEvents) ? baseEvents : [baseEvents];

    return events.map((baseEvent) => {
      // 1. Inject schemaVersion if missing
      const meta = baseEvent.meta || {};
      if (meta.schemaVersion === undefined) {
        try {
          const flow = getEventFlow(eventFlowMap)(baseEvent);
          meta.schemaVersion = flow.schemaVersion || 1;
        } catch (e) {
          meta.schemaVersion = 1;
        }
      }

      // 2. Use defaultEventCreator for id, created, causationId, correlationId, identifier
      const createdEvent = defaultEventCreator(
        {
          ...baseEvent,
          meta,
        },
        originalEvent
      );

      // 3. Finalize compensation metadata
      return {
        ...createdEvent,
        meta: {
          ...createdEvent.meta,
          isCompensating: true,
          compensatesEventId: originalEvent.id,
        },
      };
    });
  };

  /**
   * Checks if an event and all its descendants can be reverted.
   * An event can only be reverted if:
   * 1. It exists
   * 2. It is a root event (no causationId)
   * 3. All events in the tree have a compensate hook defined
   */
  const canRevert = async (eventId: string): Promise<CanRevertResult> => {
    checkRepoSupport();

    const event = (await repo.getEventById!(eventId)) as CreatedEvent<any> | null;
    if (!event) {
      return { canRevert: false, reason: `Event not found: ${eventId}` };
    }

    if (event.causationId != null) {
      return {
        canRevert: false,
        reason: `Event ${eventId} is not a root event. It was caused by event ${event.causationId}. Please revert the root event instead.`,
      };
    }

    // Collect all events in tree
    const allEvents = [event, ...(await collectEventTree(event))];
    const missing: NonNullable<CanRevertResult['missingCompensateEvents']> = [];

    for (const evt of allEvents) {
      const flowKey = `${evt.domain}__${evt.type}`;
      const eventFlow = eventFlowMap[flowKey];

      if (!eventFlow?.compensate) {
        missing.push({
          id: evt.id,
          domain: evt.domain,
          type: evt.type,
        });
      }
    }

    if (missing.length > 0) {
      return {
        canRevert: false,
        reason: `${missing.length} event(s) in the tree do not define a 'compensate' hook`,
        missingCompensateEvents: missing,
      };
    }

    return { canRevert: true };
  };

  /**
   * Preview which events would be affected by a revert operation.
   * Does not execute any changes.
   */
  const previewRevert = async (eventId: string): Promise<PreviewRevertResult> => {
    checkRepoSupport();

    const event = (await repo.getEventById!(eventId)) as CreatedEvent<any> | null;
    if (!event) {
      throw new Error(`Event not found: ${eventId}`);
    }

    if (event.causationId != null) {
      throw new Error(
        `Cannot preview revert for non-root event. ` +
          `Event ${eventId} was caused by ${event.causationId}. ` +
          `Please preview the root event instead.`
      );
    }

    const descendants = await collectEventTree(event);

    return {
      rootEvent: event,
      descendantEvents: descendants,
      totalEventCount: 1 + descendants.length,
    };
  };

  /**
   * Recursively reverts an event tree, starting from leaves (depth-first).
   */
  const revertTree = async (event: CreatedEvent<any>): Promise<RevertResult> => {
    // 1. Find all direct children
    const children = (await repo.findByCausationId!(event.id)) as CreatedEvent<any>[];

    // 2. Recursively revert children first (depth-first, leaves first)
    // Reverse order to process most recent children first
    const childResults: RevertResult[] = [];
    for (const child of [...children].reverse()) {
      childResults.push(await revertTree(child));
    }

    // 3. Generate compensating event for current event
    const flowKey = `${event.domain}__${event.type}`;
    const eventFlow = eventFlowMap[flowKey];
    const compensatingEvents: CreatedEvent<any>[] = [];

    if (eventFlow?.compensate) {
      const compensation = eventFlow.compensate(event);
      const materializedEvents = materializeCompensatingEvents(compensation, event);

      // Store compensating events
      await storeEvents(materializedEvents);
      compensatingEvents.push(...materializedEvents);
    }

    return {
      revertedEventId: event.id,
      compensatingEvents,
      childResults,
    };
  };

  /**
   * Reverts a root event and all its descendants.
   *
   * @param eventId - The ID of the root event to revert
   * @throws Error if the event is not found, not a root event, or any event lacks a compensate hook
   */
  const revert = async (eventId: string): Promise<RevertResult> => {
    // 1. Validate revertability
    const validation = await canRevert(eventId);
    if (!validation.canRevert) {
      throw new Error(`Cannot revert event ${eventId}: ${validation.reason}`);
    }

    // 2. Get the event
    const event = (await repo.getEventById!(eventId)) as CreatedEvent<any>;

    // 3. Execute tree revert
    return revertTree(event);
  };

  return { canRevert, previewRevert, revert };
};

export type MakeRevertResult = ReturnType<typeof makeRevert>;
