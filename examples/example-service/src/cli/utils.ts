import { getEventStoreService } from '../managers/event-store/EventStoreService';
import { BaseEvent } from '@schemeless/event-store';
import { AccountPackage, OrderPackage } from '../../../core-domains';
import { getProjectiveDbConnection } from '../utils/getProjectiveDbConnection';
import { Connection } from 'typeorm';
import { OrderType } from '../../../core-domains/Order';
import { logger } from '../managers/pino';

const { AccountCreated, AccountCreationRequested, AccountCredit } = AccountPackage.EventFlows;
const { OrderPlaceRequested } = OrderPackage.EventFlows;

export const resetDb = async () => {
  logger.info('reset db');
  const eventStoreService = await getEventStoreService();
  const projectiveConn = await getProjectiveDbConnection();
  await projectiveConn.synchronize(true);

  const eventStoreConn: Connection = await eventStoreService.getDbConnection();
  await eventStoreConn.synchronize(true);
};

export const replayStore = async () => {
  const eventStoreService = await getEventStoreService();
  const conn = await getProjectiveDbConnection();
  await conn.synchronize(true);
  await eventStoreService.replay();
};

export const createAccountAndGetId = async (userId: string) => {
  const eventStoreService = await getEventStoreService();
  const accountCreationRequested = await AccountCreationRequested.receiver(eventStoreService, {
    payload: {
      userId: userId,
    },
    identifier: userId,
  });

  const causationEvents = await eventStoreService.getCausationEvents(accountCreationRequested.trackingId);

  const accountCreatedEvent: BaseEvent<typeof AccountCreated.samplePayload> | undefined = causationEvents.find(
    (event) => event.type === AccountCreated.type
  );

  if (!accountCreatedEvent) throw new Error('account not found');

  return accountCreatedEvent.payload.accountId;
};

export const depositTokenToAccount = async (userId: string, accountId: string, tokenId: string, amount: number) => {
  const eventStoreService = await getEventStoreService();
  await AccountCredit.receiver(eventStoreService, {
    payload: {
      accountId,
      tokenId,
      amount,
    },
    identifier: userId,
  });
};

export const placeOrder = async (
  userId: string,
  accountId: string,
  type: OrderType,
  tokenId: string,
  amount: number,
  unitPrice: number
) => {
  const eventStoreService = await getEventStoreService();
  await OrderPlaceRequested.receiver(eventStoreService, {
    payload: {
      userId: userId,
      accountId: accountId,
      type: type,
      tokenId: tokenId,
      amount: amount,
      unitPrice: unitPrice,
    },
    identifier: userId,
  });
};
