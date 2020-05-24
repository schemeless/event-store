import { Field, ObjectType, Int, Float, ID, Root, ArgsType, InputType, registerEnumType } from 'type-graphql';
import { IsUUID, IsEnum, IsPositive, IsInt, IsNumber, Length } from 'class-validator';
import { PostStatus } from '../../../../../core-domains/Post/Post.entity';
import { PostPackage } from '../../../../../core-domains/Post';
import { Profile } from '../Profile/Profile.shape';
import { AttachmentPackage, OrderPackage, ProfilePackage } from '../../../../../core-domains';
import { Attachment } from '../Attachment/Attachment.shape';
import { ImageAttachmentEntity } from '../../../../../core-domains/Attachment/Attachment.entity';
import { OrderMatchedRecord } from '../Order/Order.shape';

registerEnumType(PostStatus, {
  name: 'PostStatus'
});

@ObjectType()
export class Post {
  @Field(type => ID)
  id: string;

  @Field({ nullable: false })
  uid: number;

  @Field({ nullable: false })
  userId: string;

  @Field()
  tokenId: string;

  @Field({ nullable: false })
  title: string;

  @Field({ nullable: false })
  content: string;

  @Field(type => PostStatus, { nullable: false })
  status: PostStatus;

  @Field({ nullable: false })
  created: Date;

  @Field({ nullable: false })
  updated: Date;

  @Field(type => [Attachment], { nullable: true })
  async attachments?(@Root() post: Post): Promise<Attachment[]> {
    if (!post.content) return [];
    const allPromise = (post.content.match(/\[\[attachment:[^:]+]]/g) || ([] as string[]))
      .map((a: string) => {
        const result = a.match(/\[\[attachment:([^/]+)\/([0-9a-f]{5,40})]]/);
        if (result == null) throw new Error('attachment regex failed: ' + a);
        const username = result[1];
        const sha = result[2];
        return { username, sha };
      })
      .map(({ username, sha }) => AttachmentPackage.Query.getAttachmentByUserAndSha(username, sha));
    return (await Promise.all(allPromise)).filter(a => a != null) as ImageAttachmentEntity[];
  }

  @Field(type => Profile, { complexity: 2 })
  async profile?(@Root() post: Post): Promise<Profile | undefined> {
    return ProfilePackage.Query.getProfileById(post.userId);
  }

  @Field(type => [OrderMatchedRecord], { complexity: 2 })
  async records?(@Root() post: Post): Promise<OrderMatchedRecord[]> {
    return OrderPackage.Query.getTokenMatchRecord(post.tokenId);
  }
}

@InputType()
export class PostCreatedInput {
  @Field()
  @Length(2, 50)
  title: string;

  @Field()
  @Length(2, 3000)
  content: string;
}
