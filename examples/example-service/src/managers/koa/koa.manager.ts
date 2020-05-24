import Koa from 'koa';

export const getKoaApp = (): Koa => {
  const koaApp = new Koa();
  return koaApp;
};
