import { AccountEntity, AccountTokenBalanceEntity } from './Account.entity';
import * as R from 'ramda';
import { getAccountEntityRepository, getAccountTokenBalanceEntityRepository } from './Account.entity.repository';

export class AccountQuery {
  static async getAccounts(where: { userId: string; accountId?: string }): Promise<AccountEntity[]> {
    const accountEntityRepo = await getAccountEntityRepository();
    return accountEntityRepo.find({ where });
  }

  static async getUserFirstAccount(userId: string): Promise<AccountEntity | undefined> {
    const accountEntityRepo = await getAccountEntityRepository();
    return accountEntityRepo.findOne({
      where: { userId },
      order: {
        created: 'ASC'
      }
    });
  }

  static async getUserAccounts(userId: string): Promise<AccountEntity[]> {
    const accountEntityRepo = await getAccountEntityRepository();
    return accountEntityRepo.find({
      where: { userId }
    });
  }

  static async getAccountById(id: string): Promise<AccountEntity | undefined> {
    const accountEntityRepo = await getAccountEntityRepository();
    const result = await accountEntityRepo.find({
      where: { id },
      take: 1
    });
    return R.nth(0)(result);
  }

  static async getAccountBalanceByTokenId(
    accountId: string,
    tokenId: string
  ): Promise<AccountTokenBalanceEntity | undefined> {
    const accountTokenBalanceEntityRepository = await getAccountTokenBalanceEntityRepository();
    const result = await accountTokenBalanceEntityRepository.find({
      where: { account: accountId, tokenId },
      take: 1
    });
    return R.nth(0)(result);
  }

  static async getAllAccountBalance(accountId: string): Promise<AccountTokenBalanceEntity[]> {
    const accountTokenBalanceEntityRepository = await getAccountTokenBalanceEntityRepository();
    return await accountTokenBalanceEntityRepository.find({
      where: { account: accountId }
    });
  }
}
