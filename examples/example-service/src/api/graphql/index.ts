import { AccountResolver } from './Account';
import { AdminResolver } from './Admin';
import { OrderResolver } from './Order';
import { AttachmentResolver } from './Attachment';
import { PostResolver } from './Post';
import { ProfileResolver } from './Profile';

const AllResolverList = [
  AccountResolver,
  AdminResolver,
  AttachmentResolver,
  OrderResolver,
  PostResolver,
  ProfileResolver
];

export {
  AllResolverList,
  AccountResolver,
  AdminResolver,
  AttachmentResolver,
  OrderResolver,
  PostResolver,
  ProfileResolver
};
