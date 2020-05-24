import { BaseEntity, Column, Entity, ManyToOne, OneToMany, PrimaryColumn } from 'typeorm';
import { AccountEntity, AccountTokenBalanceEntity } from '../Account/Account.entity';

export enum OrderStatus {
  MATCHING = 'MATCHING',
  FINISHED = 'FINISHED',
  CANCELLED = 'CANCELLED'
}

export enum OrderType {
  BUY = 'BUY',
  SELL = 'SELL'
}

@Entity()
export class OrderEntity {
  @PrimaryColumn()
  id: string;

  @Column({ nullable: false })
  userId: string;

  @Column({ nullable: false })
  accountId: string;

  @Column({ type: 'text', nullable: false })
  status: OrderStatus;

  @Column({ type: 'text', nullable: false })
  type: OrderType;

  @Column({ nullable: false })
  unitPrice: number;

  @Column({ nullable: false })
  tokenId: string;

  @Column({ nullable: false })
  amount: number;

  @Column({ nullable: false })
  amountLeft: number;

  @Column({ nullable: true })
  lastMatched: Date;

  @Column({ nullable: false })
  created: Date;

  @Column({ nullable: false })
  updated: Date;
}

@Entity()
export class OrderMatchedRecordEntity {
  @Column({ nullable: false })
  tokenId: string;

  @Column({ type: 'text', nullable: false })
  type: OrderType;

  @Column({ nullable: false })
  unitPrice: number;

  @PrimaryColumn({ nullable: false })
  mainOrderId: string; // buyOrder id

  @Column({ nullable: false })
  mainAccountId: string;

  @Column({ nullable: false })
  mainAmount: number;

  @PrimaryColumn({ nullable: false })
  tokenOrderId: string; // sell order id

  @Column({ nullable: false })
  tokenAccountId: string;

  @Column({ nullable: false })
  tokenAmount: number;

  @Column({ nullable: false })
  created: Date;
}
