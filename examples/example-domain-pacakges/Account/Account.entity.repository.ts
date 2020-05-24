import { Repository } from 'typeorm';
import { AccountEntity, AccountTokenBalanceEntity } from './Account.entity';
import { getProjectiveDbConnection } from '../../service/src/utils/getProjectiveDbConnection';

export const getAccountEntityRepository = async (): Promise<Repository<AccountEntity>> => {
  const conn = await getProjectiveDbConnection();
  return conn.getRepository<AccountEntity>(AccountEntity);
};

export const getAccountTokenBalanceEntityRepository = async (): Promise<Repository<AccountTokenBalanceEntity>> => {
  const conn = await getProjectiveDbConnection();
  return conn.getRepository<AccountTokenBalanceEntity>(AccountTokenBalanceEntity);
};
