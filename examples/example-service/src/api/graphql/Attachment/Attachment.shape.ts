import { Field, ObjectType, Int, Float, ID, Root, InputType } from 'type-graphql';

@ObjectType()
export class Attachment {
  @Field(type => ID)
  id: string;

  @Field()
  userId: string;

  @Field()
  sha1: string;

  @Field(type => Int)
  width: number;

  @Field(type => Int)
  height: number;

  @Field()
  url: string;

  @Field()
  etag: string;

  @Field({ nullable: false })
  created: Date;

  @Field({ nullable: false })
  updated: Date;
}
