import { Column, Entity, ManyToOne, OneToMany, PrimaryColumn } from 'typeorm';

@Entity()
export class AccountEntity {
  @PrimaryColumn({ nullable: false })
  id: string;

  @Column({ nullable: false })
  userId: string;

  @Column()
  updated: Date;

  @Column()
  created: Date;

  @Column({ default: true })
  active: boolean;

  @Column({ nullable: true })
  lastAttendanceUpdated?: Date;

  @OneToMany<AccountTokenBalanceEntity>(
    type => AccountTokenBalanceEntity,
    accountTokenBalance => accountTokenBalance.account
  )
  tokenBalance: AccountTokenBalanceEntity[];
}

@Entity()
export class AccountTokenBalanceEntity {
  @ManyToOne<AccountEntity>(
    type => AccountEntity,
    account => account.tokenBalance,
    {
      primary: true,
      eager: true,
      nullable: false
    }
  )
  account: AccountEntity;

  @PrimaryColumn({ nullable: false })
  tokenId: string;

  @Column()
  updated: Date;

  @Column()
  created: Date;

  @Column()
  balance: number;
}

@Entity()
export class TransactionEntity {
  @PrimaryColumn({ nullable: false })
  id: string;

  @Column()
  primaryAccountId: string;

  @Column()
  primaryTokenId: string;

  @Column()
  primaryTokenAmount: string;

  @Column()
  secondaryAccountId: string;

  @Column()
  secondaryTokenId: string;

  @Column()
  secondaryTokenAmount: string;

  @Column()
  created: Date;
}
