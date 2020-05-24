import { authRoute } from './passport.manager';
import passport from 'koa-passport';
//@ts-ignore
import WeixinStrategy from 'passport-weixin';
import { Profile } from 'passport-auth0';
import { ProfilePackage } from '../../../../core-domains';
import { getEventStoreService } from '../../managers/event-store/EventStoreService';
import { environment } from '../../env';

interface WeChatUserInfoProfile {
  nickName: string;
  gender: 0 | 1 | 2;
  language: string;
  city: string;
  province: string;
  country: string;
  avatarUrl: string;
}

passport.use(
  'loginByWeixinClient',
  new WeixinStrategy(
    {
      clientID: environment.weixin.clientId,
      clientSecret: environment.weixin.clientSecret,
      callbackURL: environment.weixin.callbackDomain + '/auth/weixin/client/callback',
      authorizationURL: 'https://api.weixin.qq.com/sns/jscode2session',
      session: false,
      scope: 'weapp_login',
      requireState: false
    },
    function(accessToken: string, refreshToken: string, profile: Profile, done: (err: any, profile: Profile) => void) {
      // const {session_key, openid} = profile._json
      profile.id = profile._json.openid;
      done(null, profile);
    }
  )
);

// not working
passport.use(
  'loginByWeixin',
  new WeixinStrategy(
    {
      clientID: environment.weixin.clientId,
      clientSecret: environment.weixin.clientSecret,
      callbackURL: environment.weixin.callbackDomain + '/auth/weixin/callback',
      requireState: false,
      scope: 'snsapi_login'
    },
    function(accessToken: string, refreshToken: string, profile: Profile, done: (err: any, profile: Profile) => void) {
      done(null, profile);
    }
  )
);

authRoute.post('/auth/weixin/client/login', passport.authenticate('loginByWeixinClient'), async ctx => {
  if (!ctx.state.user) {
    throw new Error('user null');
  }
  if (!ctx.request.body.profile) {
    throw new Error('profile null');
  }
  const found = await ProfilePackage.Query.getProfileByWeiXinOpenId(ctx.state.user._json.openid);
  if (found) {
    ctx.status = 200;
  } else {
    ctx.status = 426;
    ctx.body = 'username required, please register';
  }
});

authRoute.post('/auth/weixin/client/register', passport.authenticate('loginByWeixinClient'), async ctx => {
  if (!ctx.state.user) {
    throw new Error('user null');
  }
  if (!ctx.request.body.profile) {
    throw new Error('profile null');
  }
  if (!ctx.request.body.username) {
    throw new Error('username null');
  }

  const foundWeixin = await ProfilePackage.Query.getProfileByWeiXinOpenId(ctx.state.user._json.openid);

  if (foundWeixin) {
    ctx.status = 405;
    ctx.body = 'already registered';
    return;
  }

  const { ProfileIdentityCreated } = ProfilePackage.EventFlows;

  const profile: WeChatUserInfoProfile = ctx.request.body.profile;
  const username: string = ctx.request.body.username;
  const user = ctx.state.user;

  const foundUsername = await ProfilePackage.Query.getProfileByUsername(username);

  if (foundUsername) {
    ctx.status = 409;
    ctx.body = 'username used';
    return;
  }

  const eventStoreService = await getEventStoreService();

  await ProfileIdentityCreated.receiver(eventStoreService, {
    payload: {
      id: username,
      username: username,
      displayName: profile.nickName,
      provider: user.provider,
      email: undefined,
      picture: profile.avatarUrl,
      nickname: profile.nickName,
      raw: user._json
    },
    identifier: username
  });

  ctx.status = 201;
});

authRoute.get('/auth/weixin/qr/login', passport.authenticate('loginByWeixin'), ctx => {
  ctx.redirect('/');
});
