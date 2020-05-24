import { EventFlow } from '@schemeless/event-store';
import * as eventFlows from './events';
import { PostEntity } from './Post.entity';
import { PostQuery } from './Post.query';

const eventFlowList: EventFlow<any>[] = [eventFlows.PostCreated];

export const PostPackage = {
  Query: PostQuery,
  Entities: [PostEntity],
  EventFlows: eventFlows,
  EventFlowList: eventFlowList
};
