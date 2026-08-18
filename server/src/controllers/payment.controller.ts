import { Request, Response } from 'express'

import { sendTsRestSuccess } from '../lib/responseHandler.js'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'
import {
  PaystackWebhookPayload,
  paymentService,
} from '../services/payment.service.js'

interface VerifyPaymentParams {
  reference: string
}

export const verifyPaystackPayment = tryCatchWrapper(
  async (
    req: Request<VerifyPaymentParams>,
    res: Response,
  ) => {
    const payment =
      await paymentService.confirmPaystackPayment(
        req.params.reference,
      )

    return sendTsRestSuccess(res, 200, {
      success: true,
      message: 'Payment verified successfully',
      body: payment,
    })
  },
)

export const handlePaystackWebhook = tryCatchWrapper(
  async (req: Request, res: Response) => {
    const signature = req.get('x-paystack-signature')

    const result =
      await paymentService.processPaystackWebhook(
        req.body as PaystackWebhookPayload,
        signature,
        req.rawBody,
      )

    return sendTsRestSuccess(res, 200, {
      success: true,
      message: result.processed
        ? 'Paystack webhook processed successfully'
        : 'Paystack webhook acknowledged',
      body: result,
    })
  },
)