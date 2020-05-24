import { Arg, Field, ID, ObjectType, Root } from 'type-graphql';
import { AccountPackage } from '../../../../../core-domains/Account';
import { Order } from '../Order/Order.shape';
import { OrderPackage } from '../../../../../core-domains';
import { config } from '../../../config';
import { OrderStatus, OrderType } from '../../../../../core-domains/Order';

@ObjectType()
export class Account {
  @Field(type => ID)
  id: string;

  @Field()
  userId: string;

  @Field()
  updated: Date;

  @Field()
  created: Date;

  @Field()
  active: boolean;

  @Field()
  lastAttendanceUpdated?: Date;

  @Field(type => Date)
  async nextAttendance?(@Root() account: Account): Promise<Date> {
    if (!account.lastAttendanceUpdated) {
      return new Date();
    } else {
      return new Date(+new Date(account.lastAttendanceUpdated) + config.attendanceClaimPeriod);
    }
  }

  @Field(type => [AccountTokenBalance])
  async tokenBalances?(@Root() account: Account): Promise<AccountTokenBalance[]> {
    return AccountPackage.Query.getAllAccountBalance(account.id);
  }

  @Field(type => [Order])
  async orders?(
    @Root() account: Account,
    @Arg('tokenId', { nullable: true }) tokenId?: string,
    @Arg('type', type => OrderType, { nullable: true }) type?: OrderType,
    @Arg('status', type => OrderStatus, { nullable: true }) status?: OrderStatus
  ): Promise<Order[]> {
    return OrderPackage.Query.orders(
      Object.assign(
        { accountId: account.id },
        tokenId ? { tokenId } : {},
        type ? { type } : {},
        status ? { status } : {}
      )
    );
  }
}

@ObjectType()
export class AccountTokenBalance {
  account: Account;

  @Field(type => ID)
  accountId?(@Root() accountTokenBalance: AccountTokenBalance): string {
    return accountTokenBalance.account.id;
  }

  @Field()
  tokenId: string;

  @Field()
  balance: number;

  @Field()
  updated: Date;

  @Field()
  created: Date;
}
