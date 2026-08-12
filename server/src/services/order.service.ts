import mongoose from "mongoose";

import logger from "../config/logger.js";
import Order from "../models/order.js";
import TicketType from "../models/tickettype.js";
import { ErrorResponse } from "../middlewares/error.middleware.js";
import { paymentService } from "./payment.service.js";

export interface ExpiredOrderCleanupResult {
  examined: number;
  expired: number;
  skipped: number;
}

export class OrderService {
  private readonly cleanupBatchSize = 100;

  private async expireOrder(
    orderId: mongoose.Types.ObjectId,
  ): Promise<boolean> {
    const session = await mongoose.startSession();
    let expired = false;

    try {
      await session.withTransaction(async (): Promise<void> => {
        /*
         * Reload the order inside the transaction. Another request may
         * have completed payment after the cleanup query found it.
         */
        const order = await Order.findOne({
          _id: orderId,
          status: "pending",
          expiresAt: { $lte: new Date() },
        }).session(session);

        if (!order) {
          return;
        }

        for (const item of order.items) {
          if (!item.ticketType) {
            continue;
          }

          const ticketType = await TicketType.findOne({
            _id: item.ticketType,
            event: order.event,
          }).session(session);

          if (!ticketType) {
            logger.error(
              {
                orderId: order._id.toString(),
                ticketTypeId: item.ticketType.toString(),
              },
              "Ticket type missing while expiring order",
            );

            continue;
          }

          /*
           * Never decrement below zero. A paid-order flow may already
           * have converted this reservation into quantitySold.
           */
          const releasableQuantity = Math.min(
            item.quantity,
            ticketType.quantityReserved,
          );

          if (releasableQuantity > 0) {
            ticketType.quantityReserved -= releasableQuantity;

            await ticketType.save({ session });
          }
        }

        order.status = "expired";
        order.failureReason =
          "Checkout reservation expired before payment confirmation";

        await order.save({ session });
        expired = true;
      });
    } finally {
      await session.endSession();
    }

    return expired;
  }

  async expirePendingOrders(): Promise<ExpiredOrderCleanupResult> {
    const expiredOrderIds = await Order.find({
      status: "pending",
      expiresAt: {
        $exists: true,
        $lte: new Date(),
      },
    })
      .select("_id paystackReference")
      .sort({ expiresAt: 1 })
      .limit(this.cleanupBatchSize)
      .lean();

    let expired = 0;

    /*
     * Process orders separately so one inconsistent historical order
     * does not prevent all other reservations from being released.
     */
    for (const order of expiredOrderIds) {
      try {
        /*
         * Reconcile Paystack before releasing inventory. A customer may
         * have paid successfully while the webhook was delayed.
         */
        if (order.paystackReference) {
          try {
            await paymentService.confirmPaystackPayment(
              order.paystackReference,
            );

            // Payment succeeded and the order was finalized.
            continue;
          } catch (error: unknown) {
            /*
             * PaymentService returns 409 when Paystack confirms that the
             * transaction has not succeeded. Only then may cleanup expire
             * the reservation.
             *
             * Network/provider errors must leave the order pending so a
             * temporary Paystack outage cannot release paid inventory.
             */
            if (!(error instanceof ErrorResponse) || error.statusCode !== 409) {
              logger.error(
                {
                  err: error,
                  orderId: order._id.toString(),
                },
                "Could not reconcile expired order with Paystack",
              );

              continue;
            }
          }
        }

        const wasExpired = await this.expireOrder(order._id);

        if (wasExpired) {
          expired++;
        }
      } catch (error: unknown) {
        logger.error(
          {
            err: error,
            orderId: order._id.toString(),
          },
          "Failed to expire pending order",
        );
      }
    }

    return {
      examined: expiredOrderIds.length,
      expired,
      skipped: expiredOrderIds.length - expired,
    };
  }
}

export const orderService = new OrderService();
