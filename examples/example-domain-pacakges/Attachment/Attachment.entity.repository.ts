import { Repository } from 'typeorm';
import { getProjectiveDbConnection } from '../../service/src/utils/getProjectiveDbConnection';
import { ImageAttachmentEntity } from './Attachment.entity';

export const getImageAttachmentEntityRepository = async (): Promise<Repository<ImageAttachmentEntity>> => {
  const conn = await getProjectiveDbConnection();
  return conn.getRepository<ImageAttachmentEntity>(ImageAttachmentEntity);
};
