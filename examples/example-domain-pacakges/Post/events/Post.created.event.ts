import type { BaseEvent, EventFlow } from '@schemeless/event-store';
import { PostQuery } from '../Post.query';
import { getPostEntityRepository } from '../Post.entity.repository';
import { PostEntity, PostStatus } from '../Post.entity';
import { logger } from '../../../service/src/managers/pino';
import { AccountPackage } from '../../index';
import { config } from '../../../service/src/config';

const { AccountCredit } = AccountPackage.EventFlows;

interface Payload {
  postId: string;
  uid: number;
  userId: string;
  title: string;
  content: string;
}

const createTokenId = (userId: string, uid: number) => `${userId}/${uid}`;

export const PostCreated: EventFlow<Payload> = {
  domain: 'post',
  type: 'created',

  samplePayload: {
    userId: '<UserId>',
    postId: '<UUID>',
    uid: 1,
    title: 'title',
    content: 'content',
  },

  validator: async function (event) {
    // todo check if user valid
    const post = await PostQuery.getPostById(event.payload.postId);
    if (post) {
      return new Error(`PostCreated: Post is already exist - ${event.payload.postId}`);
    }
    const postUid = await PostQuery.getPostByUid(event.payload.userId, event.payload.postId);
    if (postUid) {
      return new Error(`PostCreated: Post UID is already exist(USED) - ${event.payload.userId}/${event.payload.uid}`);
    }

    // user have at least one account
    const account = await AccountPackage.Query.getUserFirstAccount(event.payload.userId);
    if (!account) {
      return new Error(`PostCreated: User have no account to credit: ${event.payload.userId}`);
    }
  },

  consequentEventsCreator: async (causalEvent): Promise<[BaseEvent<typeof AccountCredit.samplePayload>]> => {
    const account = await AccountPackage.Query.getUserFirstAccount(causalEvent.payload.userId);
    if (!account) {
      throw new Error(`PostCreated: User have no account to credit: ${causalEvent.payload.userId}`);
    }
    const creditAuthor: BaseEvent<typeof AccountCredit.samplePayload> = {
      domain: AccountCredit.domain,
      type: AccountCredit.type,
      payload: {
        accountId: account.id,
        tokenId: createTokenId(causalEvent.payload.userId, causalEvent.payload.uid),
        amount: config.defaultTokenLimit,
      },
    };

    return [creditAuthor];
  },

  executor: async function (event) {
    const repo = await getPostEntityRepository();
    const newPost = new PostEntity();
    const { title, content, userId, uid, postId } = event.payload;
    newPost.id = postId;
    newPost.title = title;
    newPost.content = content;
    newPost.uid = uid;
    newPost.tokenId = createTokenId(userId, uid);
    newPost.userId = userId;
    newPost.status = PostStatus.VERIFIED;
    newPost.created = event.created;
    newPost.updated = event.created;
    await repo.save(newPost);
    logger.info(`Post created: ${newPost.id}`);
  },

  receiver: (eventStoreService, eventInputArgs) =>
    eventStoreService.receiveEventInput(PostCreated.domain, PostCreated.type, eventInputArgs),
};
