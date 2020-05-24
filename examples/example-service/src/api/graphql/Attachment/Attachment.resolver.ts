import { Arg, Authorized, Ctx, Query, Resolver } from 'type-graphql';
import { ApolloContext } from '../../../managers/apollo-server/context';
import { Attachment } from './Attachment.shape';
import { AttachmentPackage } from '../../../../../core-domains';

@Resolver()
export class AttachmentResolver {
  @Authorized('USER')
  @Query(returns => [Attachment])
  async getUserAttachment(@Ctx() ctx: ApolloContext): Promise<Attachment[]> {
    return AttachmentPackage.Query.getUserImageAttachments(ctx.userId);
  }

  @Query(returns => Attachment)
  async attachments(
    @Arg('userId', { nullable: false }) userId: string,
    @Arg('sha', { nullable: false }) sha: string
  ): Promise<Attachment | undefined> {
    return AttachmentPackage.Query.getAttachmentByUserAndSha(userId, sha);
  }
}
