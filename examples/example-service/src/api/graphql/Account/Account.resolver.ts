import { Arg, Ctx, FieldResolver, Mutation, Query, Resolver, Root } from 'type-graphql/dist';
import { Authorized } from 'type-graphql';
import { BaseEvent } from '@schemeless/event-store';
import { logger } from '../../../managers/pino';
import { getEventStoreService } from '../../../managers/event-store/EventStoreService';
import { Account, AccountTokenBalance } from './Account.shape';
import { AccountPackage } from '../../../../../core-domains';
import { ApolloContext } from '../../../managers/apollo-server/context';

const { AccountCreationRequested, AccountCreated, AccountClosed, AccountCredit } = AccountPackage.EventFlows;

@Resolver()
export class AccountResolver {
  @Authorized('USER')
  @Query(returns => [Account])
  async accounts(
    @Arg('userId', { nullable: true }) userId: string,
    @Arg('accountId', { nullable: true }) accountId: string,
    @Ctx() ctx: ApolloContext
  ): Promise<Account[]> {
    if (!userId) userId = ctx.userId;
    if (userId !== ctx.userId) throw new Error('no permission for this account || userId');

    return AccountPackage.Query.getAccounts(Object.assign({ userId }, accountId ? { accountId } : {}));
  }

  @Authorized('ADMIN')
  @Mutation(returns => Account || undefined)
  async createAccount(@Ctx() ctx: ApolloContext): Promise<Account | undefined> {
    const eventStoreService = await getEventStoreService();
    const accountCreationRequested = await AccountCreationRequested.receiver(eventStoreService, {
      payload: {
        userId: ctx.userId
      },
      identifier: ctx.userId
    });

    const causationEvents = await eventStoreService.getCausationEvents(accountCreationRequested.trackingId);

    const accountCreatedEvent: BaseEvent<typeof AccountCreated.samplePayload> | undefined = causationEvents.find(
      event => event.type === AccountCreated.type
    );

    if (!accountCreatedEvent) {
      throw new Error(`accountCreatedEvent not found for ${accountCreationRequested.id}`);
    }

    logger.info(
      `new account ${accountCreatedEvent.payload.accountId} created for ${accountCreationRequested.payload.userId}`
    );
    return AccountPackage.Query.getAccountById(accountCreatedEvent.payload.accountId);
  }

  @Authorized('ADMIN')
  @Mutation(returns => Account)
  async closeAccount(@Arg('accountId') accountId: string, @Ctx() ctx: ApolloContext): Promise<Account> {
    const eventStoreService = await getEventStoreService();
    await AccountClosed.receiver(eventStoreService, {
      payload: {
        accountId,
        userId: ctx.userId
      },
      identifier: ctx.userId
    });
    logger.info(`account ${accountId} has been closed successfully.`);
    const account = await AccountPackage.Query.getAccountById(accountId);
    if (account == null) {
      throw new Error(`Account not found: ${accountId}`);
    }
    return account;
  }

  @Authorized('ADMIN')
  @Mutation(returns => Account)
  async adminDeposit(
    @Arg('accountId') accountId: string,
    @Arg('tokenId') tokenId: string,
    @Arg('amount') amount: number,
    @Ctx() ctx: ApolloContext
  ): Promise<AccountTokenBalance> {
    const eventStoreService = await getEventStoreService();
    const depositEvent = await AccountCredit.receiver(eventStoreService, {
      payload: {
        accountId,
        tokenId,
        amount
      },
      identifier: ctx.userId
    });
    logger.info(`account ${accountId} has been closed successfully.`);
    const account = await AccountPackage.Query.getAccountBalanceByTokenId(accountId, tokenId);
    if (account == null) {
      throw new Error(`Account not found: ${accountId}: ${tokenId}`);
    }
    return account;
  }
}
