import { EventFlow } from '@schemeless/event-store';

import { EntitySchema } from 'typeorm';

import { AccountPackage } from './Account';
import { OrderPackage } from './Order';
import { AttachmentPackage } from './Attachment';
import { PostPackage } from './Post';
import { ProfilePackage } from './Profile';

export const featureEntities: EntitySchema<any>[] = ([] as EntitySchema<any>[])
  .concat(AccountPackage.Entities as any)
  .concat(AttachmentPackage.Entities as any)
  .concat(OrderPackage.Entities as any)
  .concat(PostPackage.Entities as any)
  .concat(ProfilePackage.Entities as any);

export const allEventFlows: EventFlow<any>[] = ([] as EventFlow<any>[])
  .concat(AccountPackage.EventFlowList)
  .concat(AttachmentPackage.EventFlowList)
  .concat(OrderPackage.EventFlowList)
  .concat(PostPackage.EventFlowList)
  .concat(ProfilePackage.EventFlowList);

export { AccountPackage, AttachmentPackage, OrderPackage, PostPackage, ProfilePackage };
