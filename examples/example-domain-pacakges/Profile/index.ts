import { EventFlow } from '@schemeless/event-store';
import * as eventFlows from './events';
import { ProfileEntity } from './Profile.entity';
import { ProfileQuery } from './Profile.query';

const eventFlowList: EventFlow<any>[] = [eventFlows.ProfileIdentityCreated];

export const ProfilePackage = {
  Query: ProfileQuery,
  Entities: [ProfileEntity],
  EventFlows: eventFlows,
  EventFlowList: eventFlowList
};
