import {
  Args,
  Arg,
  Authorized,
  Ctx,
  Field,
  ID,
  Int,
  Mutation,
  ObjectType,
  Query,
  registerEnumType,
  Resolver
} from 'type-graphql';
import { getProjectiveDbConnection } from '../../../utils/getProjectiveDbConnection';
import { getEventStoreService } from '../../../managers/event-store/EventStoreService';
import { Connection, IsNull } from 'typeorm';
import { DbResultStatus, Event, GetEventsArgs } from './Event.shape';
import { ApolloContext } from '../../../managers/apollo-server/context';
import { logger } from '../../../managers/pino';
import { config } from '../../../config';

@ObjectType()
class DbResult {
  @Field(type => DbResultStatus)
  status: DbResultStatus;
}

@Resolver()
export class AdminResolver {
  @Authorized('ADMIN')
  @Query(returns => [Event])
  async events(
    @Arg('id', { nullable: true }) id?: string,
    @Arg('domain', { nullable: true }) domain?: string,
    @Arg('type', { nullable: true }) type?: string,
    @Arg('identifier', { nullable: true }) identifier?: string,
    @Arg('trackingId', { nullable: true }) trackingId?: string,
    @Arg('correlationId', { nullable: true }) correlationId?: string,
    @Arg('causationId', { nullable: true }) causationId?: string,
    @Arg('skip', type => Int) skip?: number,
    @Arg('take', type => Int) take?: number,
    @Arg('isRootEvent', { nullable: true }) isRootEvent?: boolean
  ): Promise<Event[]> {
    const eventStoreService = await getEventStoreService();
    const repo = await eventStoreService.getEventRepo();
    return await repo.find(
      Object.assign(
        {
          where: Object.assign(
            {},
            id ? { id } : {},
            domain ? { domain } : {},
            type ? { type } : {},
            identifier ? { identifier } : {},
            trackingId ? { trackingId } : {},
            correlationId ? { correlationId } : {},
            causationId ? { causationId } : {},
            isRootEvent ? { causationId: IsNull() } : {}
          )
        },
        skip != null ? { skip } : {},
        take != null ? { take } : {}
      )
    );
  }

  @Authorized('ADMIN')
  @Mutation(returns => DbResult)
  async projectiveReplay(@Ctx() ctx: ApolloContext): Promise<DbResult> {
    const eventStoreService = await getEventStoreService();
    const conn = await getProjectiveDbConnection();
    await conn.synchronize(true);
    await conn
      .createQueryRunner()
      .query(
        `ALTER DATABASE \`${config.dbConnections.projective.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
      );
    await eventStoreService.replay();
    logger.info('Event Store replay finished');
    return { status: DbResultStatus.success };
  }

  @Authorized('ADMIN')
  @Mutation(returns => DbResult)
  async resetEventStore(@Ctx() ctx: ApolloContext): Promise<DbResult> {
    logger.info('Event Store reset started');
    const eventStoreService = await getEventStoreService();
    const projectiveConn = await getProjectiveDbConnection();
    await projectiveConn.query(`CREATE DATABASE IF NOT EXISTS ${config.dbConnections.projective.database};`);
    await projectiveConn
      .createQueryRunner()
      .query(
        `ALTER DATABASE \`${config.dbConnections.projective.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
      );
    await projectiveConn.synchronize(true);
    const eventStoreConn: Connection = await eventStoreService.getDbConnection();
    await eventStoreConn.query(`CREATE DATABASE IF NOT EXISTS ${config.dbConnections.eventStore.database};`);
    await eventStoreConn
      .createQueryRunner()
      .query(
        `ALTER DATABASE \`${config.dbConnections.eventStore.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
      );
    await eventStoreConn.synchronize(true);
    logger.info('Event Store reset finished');
    return { status: DbResultStatus.success };
  }
}
