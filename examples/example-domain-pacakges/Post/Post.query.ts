import { getPostEntityRepository } from './Post.entity.repository';
import { PostEntity } from './Post.entity';

export class PostQuery {
  static async getAllPost(
    where: { tokenId?: string; id?: string } = {},
    skip: number = 0,
    take: number = 1000
  ): Promise<PostEntity[]> {
    const repo = await getPostEntityRepository();
    return repo.find({
      skip,
      take,
      where,
      order: {
        created: 'DESC'
      }
    });
  }

  static async getPostById(postId: string): Promise<PostEntity | undefined> {
    const repo = await getPostEntityRepository();
    return repo.findOne(postId);
  }

  static async getUserAllPost(userId: string): Promise<PostEntity[]> {
    const repo = await getPostEntityRepository();
    return repo.find({
      where: {
        userId
      }
    });
  }

  static async getPostByTokenId(tokenId: string): Promise<PostEntity | undefined> {
    const repo = await getPostEntityRepository();
    return repo.findOne({
      where: {
        tokenId
      }
    });
  }

  static async getPostByUid(userId: string, uid: string): Promise<PostEntity | undefined> {
    const repo = await getPostEntityRepository();
    return repo.findOne({
      where: {
        userId,
        uid
      }
    });
  }

  static async getLastPostByUserId(userId: string): Promise<PostEntity | undefined> {
    const repo = await getPostEntityRepository();
    return repo.findOne({
      where: {
        userId
      },
      order: {
        uid: 'DESC'
      }
    });
  }
}
