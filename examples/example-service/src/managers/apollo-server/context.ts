import { ContextFunction } from 'apollo-server-core';
import * as Sentry from '@sentry/node';
import { DefaultState, Context } from 'koa';
import { environment } from '../../env';
import { ProfilePackage } from '../../../../core-domains/Profile';
import { v4 as uuid } from 'uuid';
import { Profile } from 'passport-auth0';

export interface ApolloContext {
  userId: string;
  userRoles: string[];
  correlationId: string;
}

const userFoundList: string[] = [];
const openIdMap: { [openId: string]: string } = {}; // openId => username

const getUsernameFromPassportProfile = async (user: Profile) => {
  if (user.username) return user.username;
  if ((user as any).nickname) return (user as any).nickname; // auth0
  if (user.provider === 'weixin') {
    const userId = user.id || user._json.openid;
    if (openIdMap[userId]) return openIdMap[userId];
    const found = await ProfilePackage.Query.getProfileByWeiXinOpenId(user._json.openid);
    if (!found) throw new Error(`weixin user not found ${JSON.stringify(user)}`);
    openIdMap[userId] = found.username;
    return found.username;
  }
  throw new Error(`username not found! ${JSON.stringify(user)}`);
};

export const apolloContext: ContextFunction<{ ctx: Context }, ApolloContext> = async ({ ctx }) => {
  const correlationId = ctx.header['x-correlation-id'] || uuid();
  const context: ApolloContext = {
    userId: '',
    userRoles: [] as string[],
    correlationId
  };
  if (environment.permission.hackHeader && ctx.request.header['x-hack-header'] === environment.permission.hackHeader) {
    context.userId = (ctx.request.header['x-remote-user'] as string) || '';
    context.userRoles = ((ctx.request.header['x-remote-user-role'] as string) || '').split(',');
  } else if (ctx.isAuthenticated()) {
    const user = ctx.state.user;
    const username = await getUsernameFromPassportProfile(user);

    if (!userFoundList.includes(username)) {
      const found = await ProfilePackage.Query.getProfileByUsername(username);
      if (!found) {
        throw new Error(`apolloContext: Profile not found! username: ${username}`);
      } else {
        userFoundList.push(found.username);
      }
    }

    context.userId = username;

    const isAdmin = environment.permission.adminUserIds.includes(username);
    context.userRoles = ['USER'].concat(isAdmin ? ['ADMIN'] : []);
  }

  if (context.userId) {
    Sentry.setTag('x-correlation-id', correlationId);
    Sentry.setUser({
      id: context.userId,
      roles: context.userRoles.join(',')
    });
  }

  return context;
};
