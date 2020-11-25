import { logger } from './logger';
import type { BaseEvent } from '@schemeless/event-store-types';

const trimId = (str: string | null | undefined) => (str || '----').substr(-4);

export const logEvent = (event: BaseEvent<any>, icon: string, text: string, ...moreArgs) => {
  logger.info(
    `📦 ${icon.trim()} |` +
      `${event.domain}:${event.type}`.padEnd(25) +
      `|${text.padEnd(12)} |ID:${trimId(event.id)}|COR:${trimId(event.correlationId)}|CAU:${trimId(event.causationId)}`,
    ...moreArgs
  );
};
