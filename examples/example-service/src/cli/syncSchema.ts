import { getProjectiveDbConnection } from '../utils/getProjectiveDbConnection';
import { getEventStoreService } from '../managers/event-store/EventStoreService';
import { logger } from '../managers/pino';
import '../managers/sentry/sentry';
import { config } from '../config';

const syncSchema = async () => {
  const eventStoreService = await getEventStoreService();
  logger.info('db sync starting');
  const projectiveDbConnection = await getProjectiveDbConnection();
  await projectiveDbConnection
    .createQueryRunner()
    .query(
      `ALTER DATABASE \`${config.dbConnections.projective.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
    );
  logger.info('projectiveDbConnection got');
  await projectiveDbConnection.synchronize(false);
  logger.info('projectiveDbConnection synced');

  const eventStoreServiceConn = await eventStoreService.getDbConnection();
  await eventStoreServiceConn
    .createQueryRunner()
    .query(
      `ALTER DATABASE \`${config.dbConnections.eventStore.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
    );
  logger.info('eventStoreServiceConn got');
  await eventStoreServiceConn.synchronize(false);
  logger.info('projectiveDbConnection synced');
  process.exit(0);
};

syncSchema();
