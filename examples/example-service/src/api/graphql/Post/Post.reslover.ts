import { Arg, Authorized, Ctx, Int, Mutation, Query, Resolver } from 'type-graphql';
import { ApolloContext } from '../../../managers/apollo-server/context';
import { getEventStoreService } from '../../../managers/event-store/EventStoreService';
import { Post, PostCreatedInput } from './Post.shape';
import { PostPackage } from '../../../../../core-domains';
import { v4 as uuid } from 'uuid';

const { PostCreated } = PostPackage.EventFlows;

@Resolver(of => Post)
export class PostResolver {
  @Query(returns => [Post])
  async posts(
    @Arg('skip', type => Int, { nullable: true }) skip: number = 0,
    @Arg('take', type => Int, { nullable: true }) take: number = 1000,
    @Arg('tokenId', { nullable: true }) tokenId?: string,
    @Arg('id', { nullable: true }) id?: string
  ): Promise<Post[]> {
    return PostPackage.Query.getAllPost(Object.assign({}, tokenId ? { tokenId } : {}, id ? { id } : {}), skip, take);
  }

  @Authorized('USER')
  @Mutation(returns => Post || undefined)
  async createPost(@Arg('input') input: PostCreatedInput, @Ctx() ctx: ApolloContext): Promise<Post> {
    const eventStoreService = await getEventStoreService();
    const latestPost = await PostPackage.Query.getLastPostByUserId(ctx.userId);
    const uid = latestPost ? latestPost.uid + 1 : 1;
    const postId = uuid();
    const postCreateEvent = await PostCreated.receiver(eventStoreService, {
      payload: {
        postId,
        userId: ctx.userId,
        uid,
        title: input.title,
        content: input.content
      },
      identifier: ctx.userId
    });
    const createdPost = await PostPackage.Query.getPostById(postId);
    if (!createdPost) {
      throw new Error(`createPost: post not found ${ctx.userId}/${uid} : ${postId}`);
    }
    return createdPost;
  }
}
