import { EventFlow } from '@schemeless/event-store';
import * as eventFlows from './events';
import { AttachmentQuery } from './Attachment.query';
import { ImageAttachmentEntity } from './Attachment.entity';

const eventFlowList: EventFlow<any>[] = [eventFlows.AttachmentS3ImageUploaded, eventFlows.AttachmentCOSImageUploaded];

export const AttachmentPackage = {
  Query: AttachmentQuery,
  Entities: [ImageAttachmentEntity],
  EventFlows: eventFlows,
  EventFlowList: eventFlowList
};
