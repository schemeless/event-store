import { OrderEntity, OrderMatchedRecordEntity, OrderStatus, OrderType } from './Order.entity';
import { getOrderEntityRepository, getOrderMatchedRecordEntityRepository } from './Order.entity.repository';
import { LessThanOrEqual, MoreThanOrEqual } from 'typeorm';

export class OrderQuery {
  static async orders(where: {
    accountId: string;
    id?: string;
    status?: OrderStatus;
    type?: OrderType;
  }): Promise<OrderEntity[]> {
    const orderEntityRepo = await getOrderEntityRepository();
    return orderEntityRepo.find(where);
  }

  static async getOrderById(orderId: string): Promise<OrderEntity | undefined> {
    const orderEntityRepo = await getOrderEntityRepository();
    return orderEntityRepo.findOne(orderId);
  }

  static async getOrderMatchedRecord(orderId: string, orderType: OrderType): Promise<OrderMatchedRecordEntity[]> {
    const matchedRecordEntityRepository = await getOrderMatchedRecordEntityRepository();
    const where = orderType === OrderType.BUY ? { mainOrderId: orderId } : { tokenOrderId: orderId };
    return matchedRecordEntityRepository.find({
      where,
      order: {
        created: 'DESC'
      }
    });
  }

  static async getTokenMatchRecord(tokenId: string): Promise<OrderMatchedRecordEntity[]> {
    const repo = await getOrderMatchedRecordEntityRepository();
    return repo.find({
      where: {
        tokenId
      },
      order: {
        created: 'DESC'
      }
    });
  }

  static async getOrderByAccountAndToken(accountId: string, tokenId: string): Promise<OrderEntity | undefined> {
    const orderEntityRepo = await getOrderEntityRepository();
    return orderEntityRepo.findOne({
      where: {
        status: OrderStatus.MATCHING,
        tokenId,
        accountId
      }
    });
  }

  static async findMatchedBuyOrder(tokenId: string, unitPrice: number): Promise<OrderEntity | undefined> {
    const orderEntityRepo = await getOrderEntityRepository();
    return orderEntityRepo.findOne({
      where: {
        status: OrderStatus.MATCHING,
        type: OrderType.BUY,
        tokenId,
        unitPrice: MoreThanOrEqual(unitPrice)
      },
      order: {
        unitPrice: 'DESC',
        updated: 'ASC'
      }
    });
  }

  static async findMatchedSellOrder(tokenId: string, unitPrice: number): Promise<OrderEntity | undefined> {
    const orderEntityRepo = await getOrderEntityRepository();
    return orderEntityRepo.findOne({
      where: {
        status: OrderStatus.MATCHING,
        type: OrderType.SELL,
        tokenId,
        unitPrice: LessThanOrEqual(unitPrice)
      },
      order: {
        unitPrice: 'ASC',
        updated: 'ASC'
      }
    });
  }
}
