import { Repository } from 'typeorm';
import { OrderEntity, OrderMatchedRecordEntity } from './Order.entity';
import { getProjectiveDbConnection } from '../../service/src/utils/getProjectiveDbConnection';

export const getOrderEntityRepository = async (): Promise<Repository<OrderEntity>> => {
  const conn = await getProjectiveDbConnection();
  return conn.getRepository<OrderEntity>(OrderEntity);
};

export const getOrderMatchedRecordEntityRepository = async (): Promise<Repository<OrderMatchedRecordEntity>> => {
  const conn = await getProjectiveDbConnection();
  return conn.getRepository<OrderMatchedRecordEntity>(OrderMatchedRecordEntity);
};
