import { Field, ObjectType, Int, Float, ID, Root, ArgsType, InputType, registerEnumType } from 'type-graphql';
import { AccountPackage, PostPackage } from '../../../../../core-domains';
import { Account } from '../Account/Account.shape';
import { Post } from '../Post/Post.shape';

@ObjectType()
export class SelfProfile {
  @Field(type => ID)
  id: string;

  @Field({ nullable: true })
  email?: string;

  @Field({ nullable: false })
  username: string;

  @Field({ nullable: false })
  displayName: string;

  @Field({ nullable: true })
  picture?: string;

  @Field({ nullable: false })
  created: Date;

  @Field({ nullable: false })
  updated: Date;

  @Field(type => [Post], { complexity: 2 })
  async posts?(@Root() profile: SelfProfile): Promise<Post[]> {
    return PostPackage.Query.getUserAllPost(profile.id);
  }

  @Field(type => [Account], { complexity: 2 })
  async accounts?(@Root() profile: SelfProfile): Promise<Account[]> {
    return AccountPackage.Query.getUserAccounts(profile.id);
  }
}

@ObjectType()
export class Profile {
  @Field(type => ID)
  id: string;

  @Field({ nullable: false })
  username: string;

  @Field({ nullable: false })
  displayName: string;

  @Field({ nullable: true })
  picture?: string;

  @Field(type => [Post], { complexity: 2 })
  async posts?(@Root() profile: Profile): Promise<Post[]> {
    return PostPackage.Query.getUserAllPost(profile.id);
  }
}
