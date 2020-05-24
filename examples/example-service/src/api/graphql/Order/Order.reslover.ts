import { Arg, Authorized, Ctx, Mutation, Query, Resolver } from 'type-graphql';
import { ApolloContext } from '../../../managers/apollo-server/context';
import { getEventStoreService } from '../../../managers/event-store/EventStoreService';
import { BaseEvent } from '@schemeless/event-store';
import { logger } from '../../../managers/pino';
import { Order, OrderPlaceRequestedInput } from './Order.shape';
import { OrderPackage } from '../../../../../core-domains';
import { OrderStatus, OrderType } from '../../../../../core-domains/Order';

const { OrderPlaced, OrderPlaceRequested, OrderCancelled } = OrderPackage.EventFlows;

@Resolver(of => Order)
export class OrderResolver {
  @Authorized('USER')
  @Query(returns => [Order])
  async orders(
    @Arg('accountId', { nullable: false }) accountId: string,
    @Arg('tokenId', { nullable: true }) tokenId?: string,
    @Arg('type', type => OrderType, { nullable: true }) type?: OrderType,
    @Arg('status', type => OrderStatus, { nullable: true }) status?: OrderStatus
  ): Promise<Order[]> {
    return OrderPackage.Query.orders(
      Object.assign({ accountId }, tokenId ? { tokenId } : {}, type ? { type } : {}, status ? { status } : {})
    );
  }

  @Authorized('USER')
  @Mutation(returns => Order || undefined)
  async placeOrder(
    @Arg('input') input: OrderPlaceRequestedInput,
    @Ctx() ctx: ApolloContext
  ): Promise<Order | undefined> {
    const eventStoreService = await getEventStoreService();
    const orderPlaceRequested = await OrderPlaceRequested.receiver(eventStoreService, {
      payload: {
        userId: ctx.userId,
        accountId: input.accountId,
        type: input.type,
        tokenId: input.tokenId,
        amount: input.amount,
        unitPrice: input.unitPrice
      },
      identifier: ctx.userId
    });

    const causationEvents = await eventStoreService.getCausationEvents(orderPlaceRequested.trackingId);

    const orderPlacedEvent: BaseEvent<typeof OrderPlaced.samplePayload> | undefined = causationEvents.find(
      event => event.type === OrderPlaced.type
    );

    if (!orderPlacedEvent) {
      throw new Error(`orderPlacedEvent not found for ${orderPlaceRequested.id}`);
    }

    logger.info(`new account ${orderPlacedEvent.payload.id} created for ${orderPlaceRequested.payload.accountId}`);
    return OrderPackage.Query.getOrderById(orderPlacedEvent.payload.id);
  }

  @Authorized('USER')
  @Mutation(returns => Order || undefined)
  async cancelOrder(@Arg('orderId') orderId: string, @Ctx() ctx: ApolloContext): Promise<Order | undefined> {
    const eventStoreService = await getEventStoreService();
    const orderCancelRequested = await OrderCancelled.receiver(eventStoreService, {
      payload: {
        userId: ctx.userId,
        id: orderId
      },
      identifier: ctx.userId
    });

    return OrderPackage.Query.getOrderById(orderId);
  }
}
