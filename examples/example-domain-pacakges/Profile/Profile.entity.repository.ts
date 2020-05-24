import { Repository } from 'typeorm';
import { ProfileEntity } from './Profile.entity';
import { getProjectiveDbConnection } from '../../service/src/utils/getProjectiveDbConnection';

export const getProfileEntityRepository = async (): Promise<Repository<ProfileEntity>> => {
  const conn = await getProjectiveDbConnection();
  return conn.getRepository<ProfileEntity>(ProfileEntity);
};
