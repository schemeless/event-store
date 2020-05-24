import * as R from 'ramda';
import { ImageAttachmentEntity } from './Attachment.entity';
import { getImageAttachmentEntityRepository } from './Attachment.entity.repository';

export class AttachmentQuery {
  static async getUserImageAttachments(userId: string): Promise<ImageAttachmentEntity[]> {
    const repo = await getImageAttachmentEntityRepository();
    return repo.find({
      where: { userId }
    });
  }

  static async getAttachmentByUserAndSha(userId: string, sha1: string): Promise<ImageAttachmentEntity | undefined> {
    const repo = await getImageAttachmentEntityRepository();
    return repo.findOne({
      where: {
        userId,
        sha1
      }
    });
  }
}
