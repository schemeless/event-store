import _debug from 'debug';
const debug = _debug('schemeless:event-store');
const logFunc = (level: string) => (str: string, ...args) => debug(level.padEnd(5) + ':' + str, ...args);

export const logger = {
  fatal: logFunc('fatal'),
  error: logFunc('error'),
  warn: logFunc('warn'),
  info: logFunc('info'),
  debug: logFunc('debug'),
  trace: logFunc('trace'),
};
