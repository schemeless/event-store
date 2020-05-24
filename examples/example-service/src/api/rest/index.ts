import Router from 'koa-router';
import { DefaultState, Context } from 'koa';

export const restfulRouter = new Router<DefaultState, Context>();

restfulRouter.get('/api/rest/me', async (ctx: Context, next) => {
  if (!ctx.isAuthenticated()) {
    ctx.status = 401;
    return;
  }
  ctx.body = ctx.state.user;
  ctx.status = 200;
});
