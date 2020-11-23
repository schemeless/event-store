import type { BaseEvent, EventFlow } from '@schemeless/event-store';
import { ProfileQuery } from '../Profile.query';
import { getProfileEntityRepository } from '../Profile.entity.repository';
import { ProfileEntity } from '../Profile.entity';
import { logger } from '../../../service/src/managers/pino';
import { AccountCreationRequested } from '../../Account/events';
import { AccountPackage } from '../../index';

interface Payload {
  displayName: string;
  id: string;
  username: string;
  provider: 'auth0' | 'weixin' | string;
  email?: string;
  picture?: string;
  nickname: string;
  raw: any;
}

export const ProfileIdentityCreated: EventFlow<Payload> = {
  domain: 'profile',
  type: 'identityCreated',

  samplePayload: {
    id: 'aki',
    username: 'aki',
    displayName: 'aki',
    provider: 'auth0',
    email: 'a@a.com',
    picture: 'http://xxx',
    nickname: '',
    raw: { sub: 'xxx' } as any,
  },

  validator: async function (event) {
    const foundId = await ProfileQuery.getProfileById(event.payload.id);
    if (foundId) return new Error(`ProfileIdentityCreated: id is already existed ${event.payload.id}`);

    const foundUsername = await ProfileQuery.getProfileByUsername(event.payload.username);
    if (foundUsername)
      return new Error(`ProfileIdentityCreated: username is already existed ${event.payload.username}`);
  },

  consequentEventsCreator: async (
    causalEvent
  ): Promise<[BaseEvent<typeof AccountCreationRequested.samplePayload>] | []> => {
    // create first account, if already exists, skip
    const found = await AccountPackage.Query.getUserFirstAccount(causalEvent.payload.id);
    if (found) {
      return [];
    }
    const event: BaseEvent<typeof AccountCreationRequested.samplePayload> = {
      domain: AccountCreationRequested.domain,
      type: AccountCreationRequested.type,
      payload: {
        userId: causalEvent.payload.id,
      },
    };

    return [event];
  },

  executor: async function (event) {
    const repo = await getProfileEntityRepository();
    const { payload } = event;
    const raw = payload.raw;
    if (payload.provider === 'auth0') {
      const found = await ProfileQuery.getProfileById(payload.username);
      const identity = {
        type: payload.provider,
        id: raw.sub,
        raw: payload.raw,
      };
      if (found) {
        found.identities.push(identity);
        found.updated = event.created;
        await repo.save(found);
      } else {
        const newProfile = new ProfileEntity();
        newProfile.id = payload.username;
        newProfile.email = payload.email;
        newProfile.username = payload.username;
        newProfile.displayName = payload.displayName;
        newProfile.picture = payload.picture;
        newProfile.auth0Subject = raw.sub;
        newProfile.identities = [identity];

        newProfile.created = event.created;
        newProfile.updated = event.created;

        await repo.save(newProfile);
        logger.info(`Profile created: ${newProfile.id}`);
      }
    } else if (payload.provider === 'weixin') {
      const found = await ProfileQuery.getProfileById(payload.username);
      const identity = {
        type: payload.provider,
        id: raw.openid,
        raw: payload.raw,
      };
      if (found) {
        found.identities.push(identity);
        found.updated = event.created;
        await repo.save(found);
      } else {
        const newProfile = new ProfileEntity();
        newProfile.id = payload.username;
        newProfile.email = payload.email;
        newProfile.username = payload.username;
        newProfile.displayName = payload.displayName;
        newProfile.picture = payload.picture;
        newProfile.weixinOpenId = raw.openid;
        newProfile.identities = [identity];

        newProfile.created = event.created;
        newProfile.updated = event.created;

        await repo.save(newProfile);
        logger.info(`Profile created: ${newProfile.id}`);
      }
    } else {
      throw new Error(`ProfileIdentityCreated: provider not implemented ${payload.provider} for ${payload.username}`);
    }
  },

  receiver: (eventStoreService, eventInputArgs) =>
    eventStoreService.receiveEventInput(ProfileIdentityCreated.domain, ProfileIdentityCreated.type, eventInputArgs),
};
