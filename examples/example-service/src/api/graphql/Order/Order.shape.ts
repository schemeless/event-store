import { Field, ObjectType, Int, Float, ID, Root, InputType, registerEnumType } from 'type-graphql';
import { IsUUID, IsEnum, IsPositive, IsInt, IsNumber } from 'class-validator';
import { OrderPackage, OrderStatus, OrderType } from '../../../../../core-domains/Order';

registerEnumType(OrderType, {
  name: 'OrderType'
});

registerEnumType(OrderStatus, {
  name: 'OrderStatus'
});

@ObjectType()
export class Order {
  @Field(type => ID)
  id: string;

  @Field({ nullable: false })
  userId: string;

  @Field({ nullable: false })
  accountId: string;

  @Field(type => OrderStatus, { nullable: false })
  status: OrderStatus;

  @Field(type => OrderType, { nullable: false })
  type: OrderType;

  @Field({ nullable: false })
  unitPrice: number;

  @Field({ nullable: false })
  tokenId: string;

  @Field({ nullable: false })
  amount: number;

  @Field({ nullable: false })
  amountLeft: number;

  @Field({ nullable: true })
  lastMatched: Date;

  @Field(type => [OrderMatchedRecord])
  async records?(@Root() order: Order): Promise<OrderMatchedRecord[]> {
    return OrderPackage.Query.getOrderMatchedRecord(order.id, order.type);
  }

  @Field({ nullable: false })
  created: Date;

  @Field({ nullable: false })
  updated: Date;
}

@ObjectType()
export class OrderMatchedRecord {
  @Field({ nullable: false })
  tokenId: string;

  @Field(type => OrderType, { nullable: false })
  type: OrderType;

  @Field({ nullable: false })
  unitPrice: number;

  @Field({ nullable: false })
  mainOrderId: string;

  @Field({ nullable: false })
  mainAccountId: string;

  @Field({ nullable: false })
  mainAmount: number;

  @Field({ nullable: false })
  tokenOrderId: string;

  @Field({ nullable: false })
  tokenAccountId: string;

  @Field({ nullable: false })
  tokenAmount: number;

  @Field({ nullable: false })
  created: Date;
}

@InputType()
export class OrderPlaceRequestedInput {
  @Field()
  @IsUUID('4')
  accountId: string;

  @Field(type => OrderType)
  @IsEnum(OrderType)
  type: OrderType;

  @Field()
  tokenId: string;

  @Field(type => Int)
  @IsNumber()
  @IsInt()
  @IsPositive()
  amount: number;

  @Field(type => Float)
  @IsNumber()
  @IsPositive()
  unitPrice: number;
}
