import { Request, Response } from 'express'

import { sendTsRestSuccess } from '../lib/responseHandler.js'
import tryCatchWrapper from '../lib/tryCatchWrapper.js'
import {
  CheckoutItemInput,
  checkoutService,
} from '../services/checkout.service.js'

interface CheckoutParams {
  eventId: string
}

interface CheckoutRequestBody {
  customer: {
    fullname: string
    email: string
    phone?: string
  }
  items: CheckoutItemInput[]
}

export const createCheckout = tryCatchWrapper(
  async (
    req: Request<
      CheckoutParams,
      unknown,
      CheckoutRequestBody
    >,
    res: Response,
  ) => {
    const checkout = await checkoutService.createPaidCheckout({
      eventId: req.params.eventId,
      buyerId: req.session.userId,
      customer: req.body.customer,
      items: req.body.items,
    })

    return sendTsRestSuccess(res, 201, {
      success: true,
      message: 'Checkout initialized successfully',
      body: checkout,
    })
  },
)