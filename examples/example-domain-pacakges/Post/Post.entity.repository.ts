import { Repository } from 'typeorm';
import { PostEntity } from './Post.entity';
import { getProjectiveDbConnection } from '../../service/src/utils/getProjectiveDbConnection';

export const getPostEntityRepository = async (): Promise<Repository<PostEntity>> => {
  const conn = await getProjectiveDbConnection();
  return conn.getRepository<PostEntity>(PostEntity);
};
