import { AccountPackage } from '../../../core-domains';
import { createAccountAndGetId, depositTokenToAccount, placeOrder, resetDb } from './utils';
import { config } from '../config';
import { logger } from '../managers/pino';
import { OrderType } from '../../../core-domains/Order';

const { AccountCreated, AccountCreationRequested } = AccountPackage.EventFlows;

const main = async () => {
  await resetDb();
  logger.info('database reset');

  // here are user
  const cUser: string = 'C.C.';
  const vUser: string = 'V.V.';
  const kUser: string = 'K.K.';
  const lUser: string = 'akinoniku';
  const adminUser: string = 'Admin';

  // create Accounts
  logger.info('account creating');
  const cUserAccountId = await createAccountAndGetId(cUser);
  const vUserAccountId = await createAccountAndGetId(vUser);
  const kUserAccountId = await createAccountAndGetId(kUser);
  const lUserAccountId = await createAccountAndGetId(lUser);

  // give them money, 10,000 for every one
  logger.info('free money');
  await depositTokenToAccount(adminUser, cUserAccountId, config.baseToken, 10000);
  await depositTokenToAccount(adminUser, vUserAccountId, config.baseToken, 10000);
  await depositTokenToAccount(adminUser, kUserAccountId, config.baseToken, 10000);
  await depositTokenToAccount(adminUser, lUserAccountId, config.baseToken, 10000);

  const tokenApple = 'apple';
  const tokenOrange = 'orange';
  const tokenBanana = 'banana';

  // give them token, apple, orange, banana
  logger.info('free token');
  await depositTokenToAccount(cUser, cUserAccountId, tokenApple, 10000);
  await depositTokenToAccount(cUser, cUserAccountId, tokenOrange, 10000);
  await depositTokenToAccount(cUser, cUserAccountId, tokenBanana, 10000);

  await depositTokenToAccount(vUser, vUserAccountId, tokenApple, 10000);
  await depositTokenToAccount(vUser, vUserAccountId, tokenOrange, 10000);
  await depositTokenToAccount(vUser, vUserAccountId, tokenBanana, 10000);

  await depositTokenToAccount(kUser, kUserAccountId, tokenApple, 10000);
  await depositTokenToAccount(kUser, kUserAccountId, tokenOrange, 10000);
  await depositTokenToAccount(kUser, kUserAccountId, tokenBanana, 10000);

  await depositTokenToAccount(lUser, lUserAccountId, tokenApple, 10000);
  await depositTokenToAccount(lUser, lUserAccountId, tokenOrange, 10000);
  await depositTokenToAccount(lUser, lUserAccountId, tokenBanana, 10000);

  // give them token, cake, vegetable, koala
  logger.info('place order');
  await placeOrder(cUser, cUserAccountId, OrderType.SELL, tokenApple, 100, 10);
  await placeOrder(vUser, vUserAccountId, OrderType.SELL, tokenApple, 100, 11);
  await placeOrder(kUser, kUserAccountId, OrderType.SELL, tokenApple, 100, 12);

  await placeOrder(cUser, cUserAccountId, OrderType.SELL, tokenOrange, 100, 100);
  await placeOrder(vUser, vUserAccountId, OrderType.SELL, tokenOrange, 100, 110);
  await placeOrder(kUser, kUserAccountId, OrderType.SELL, tokenOrange, 100, 120);

  await placeOrder(cUser, cUserAccountId, OrderType.SELL, tokenBanana, 100, 1000);
  await placeOrder(vUser, vUserAccountId, OrderType.SELL, tokenBanana, 100, 1100);
  await placeOrder(kUser, kUserAccountId, OrderType.SELL, tokenBanana, 100, 1200);

  await placeOrder(lUser, lUserAccountId, OrderType.BUY, tokenApple, 350, 15);

  process.exit(0);
};

main();
