import Auth0Strategy, { Profile } from 'passport-auth0';
import { environment } from '../../env';
import passport from 'koa-passport';
import { ProfilePackage } from '../../../../core-domains';
import { getEventStoreService } from '../../managers/event-store/EventStoreService';
import { authRoute } from './passport.manager';

export const auth0Strategy = new Auth0Strategy(
  {
    domain: environment.auth0.domain,
    clientID: environment.auth0.clientId,
    clientSecret: environment.auth0.clientSecret,
    callbackURL: environment.auth0.callbackDomain + '/auth/auth/callback'
  },
  function(accessToken, refreshToken, extraParams, profile, done) {
    // accessToken is the token to call Auth0 API (not needed in the most cases)
    // extraParams.id_token has the JSON Web Token
    // profile has all the information from the user
    profile.username = profile.username || (profile as any).nickname;
    return done(null, profile);
  }
);

passport.use(auth0Strategy);

authRoute.get('/auth/auth0/callback', passport.authenticate('auth0', { failureRedirect: '/login' }), async ctx => {
  const eventStoreService = await getEventStoreService();
  if (!ctx.state.user) {
    throw new Error('user null');
  }
  const user: Profile = ctx.state.user;
  const { ProfileIdentityCreated } = ProfilePackage.EventFlows;

  const username = user.username || (user as any).nickname;

  const found = await ProfilePackage.Query.getProfileByUsername(username);
  const firstEmail = user.emails?.pop();

  if (!firstEmail) {
    throw new Error(`login for user: ${user.username}, but email is required`);
  }

  if (!found) {
    await ProfileIdentityCreated.receiver(eventStoreService, {
      payload: {
        id: username,
        username: username,
        displayName: user.displayName,
        provider: user.provider,
        email: firstEmail.value,
        picture: (user as any).picture,
        nickname: (user as any).nickname,
        raw: user._json
      },
      identifier: username
    });
  }

  ctx.redirect('/');
});

authRoute.get(
  '/auth/auth0/login',
  passport.authenticate('auth0', {
    scope: 'openid profile email'
  }),
  ctx => {
    ctx.redirect('/');
  }
);
