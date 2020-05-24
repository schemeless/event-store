import { createConnection, getConnection as _getConnection, EntitySchema, ConnectionOptions } from 'typeorm';
import { logger } from '..';

export const getConnection = async (
  entities: (Function | string | EntitySchema<any>)[],
  options: ConnectionOptions
) => {
  try {
    const oldConn = _getConnection(options.name);
    if (oldConn && oldConn.isConnected) {
      logger.debug('old connection found');
      return oldConn;
    }
  } catch (e) {
    logger.debug('no default connection');
  }
  logger.info('creating new connection');
  const conn = await createConnection(Object.assign({}, options, { entities }));
  logger.info(`new connection created, is conected ${conn.isConnected}`);
  return conn;
};
