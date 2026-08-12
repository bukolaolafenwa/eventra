import logger from "../config/logger.js";
import { orderService } from "../services/order.service.js";

const ORDER_EXPIRY_INTERVAL_MS = 60 * 1000;

let expiryTimer: NodeJS.Timeout | undefined;
let cleanupIsRunning = false;

const runOrderExpiryCleanup = async (): Promise<void> => {
  if (cleanupIsRunning) {
    return;
  }

  cleanupIsRunning = true;

  try {
    const result =
      await orderService.expirePendingOrders();

    if (result.examined > 0) {
      logger.info(
        result,
        "Pending order expiry cleanup completed",
      );
    }
  } catch (error: unknown) {
    logger.error(
      { err: error },
      "Pending order expiry cleanup failed",
    );
  } finally {
    cleanupIsRunning = false;
  }
};

export const startOrderExpiryJob = (): void => {
  if (expiryTimer) {
    return;
  }

  void runOrderExpiryCleanup();

  expiryTimer = setInterval(() => {
    void runOrderExpiryCleanup();
  }, ORDER_EXPIRY_INTERVAL_MS);

  /*
   * Do not keep the Node process alive solely because of this timer.
   */
  expiryTimer.unref();

  logger.info("Order expiry job started");
};

export const stopOrderExpiryJob = (): void => {
  if (!expiryTimer) {
    return;
  }

  clearInterval(expiryTimer);
  expiryTimer = undefined;

  logger.info("Order expiry job stopped");
};