import { ArgsType, Field, ID, Int, ObjectType, registerEnumType } from 'type-graphql';

@ObjectType()
export class Event {
  @Field(type => ID)
  id: number;

  @Field()
  domain: string;

  @Field()
  type: string;

  @Field()
  payload: string;

  @Field({ nullable: true })
  identifier?: string;

  @Field({ nullable: true })
  trackingId?: string;

  @Field({ nullable: true })
  correlationId?: string;

  @Field({ nullable: true })
  causationId?: string;

  @Field()
  created: Date;
}

export enum DbResultStatus {
  success = 'success',
  fail = 'fail'
}

@ArgsType()
export class GetEventsArgs {
  @Field(type => ID, { nullable: true })
  id: string;

  @Field({ nullable: true })
  domain?: string;

  @Field({ nullable: true })
  type?: string;

  @Field({ nullable: true })
  identifier?: string;

  @Field({ nullable: true })
  trackingId?: string;

  @Field({ nullable: true })
  correlationId?: string;

  @Field({ nullable: true })
  causationId?: string;

  @Field(type => Int, { nullable: true, defaultValue: 0 })
  skip?: number;

  @Field(type => Int, { nullable: true, defaultValue: 1000 })
  take?: number;
}

registerEnumType(DbResultStatus, {
  name: 'DbResultStatus'
});
