import { createConnection, getConnection as _getConnection, EntitySchema, ConnectionOptions } from 'typeorm';
import { logger } from './utils/logger';

export const getConnection = async (
  entities: (Function | string | EntitySchema<any>)[],
  options?: ConnectionOptions
) => {
  try {
    const oldConn = _getConnection(options.name);
    if (oldConn) {
      return oldConn;
    }
  } catch (e) {
    logger.debug('no default connection');
  }
  return createConnection(Object.assign({}, options, { entities }));
};
