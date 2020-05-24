import Router from 'koa-router';
import passport from 'koa-passport';
import { DefaultState, Context } from 'koa';

passport.serializeUser(function(user, done) {
  done(null, user);
});

passport.deserializeUser(function(user, done) {
  done(null, user);
});

export const authRoute = new Router<DefaultState, Context>();

authRoute.get('/auth/logout', async (ctx: Context, next) => {
  await ctx.logout();
  ctx.redirect('/');
});
