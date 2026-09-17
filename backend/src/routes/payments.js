import { Router } from "express";
import { randomUUID } from "crypto";
import { isDemoMode, stadepassRequest } from "../stadepass/client.js";
import { saveOrder } from "../tickets/store.js";

const router = Router();

/**
 * Partner payment (not a Core API) then guide step 6: POST /purchases
 * Docs body only:
 *   order_id, amount, currency, payment_method, payment_reference, hold_ids, customer
 * Holds must already exist (POST /holds) and checkout must be readable.
 */
router.post("/pay", async (req, res, next) => {
  try {
    const {
      session_id,
      hold_ids: bodyHoldIds = [],
      payment_method = "ORANGE_MONEY",
      payment_status = "yes",
      event_title = null,
      customer = null,
    } = req.body || {};

    if (!session_id) {
      return res.status(400).json({ error: "session_id is required" });
    }

    const ok =
      payment_status === true ||
      String(payment_status).toLowerCase() === "yes" ||
      String(payment_status).toLowerCase() === "success";

    if (!ok) {
      return res.status(402).json({
        success: false,
        payment_status: "no",
        message: "Payment not confirmed — purchase not sent to Core",
      });
    }

    const checkoutRes = await stadepassRequest({
      method: "GET",
      path: `/api/v1/public/booking-sessions/${session_id}/checkout`,
    });
    const checkout = checkoutRes.data || checkoutRes;
    const fromCheckout = (checkout.items || []).map((i) => String(i.hold_id)).filter(Boolean);
    const holdIds = (Array.isArray(bodyHoldIds) && bodyHoldIds.length
      ? bodyHoldIds.map(String)
      : fromCheckout
    ).filter(Boolean);

    if (!holdIds.length) {
      return res.status(400).json({
        error: "No hold_ids — reserve seats with POST /holds, then GET /checkout before paying",
      });
    }

    const amount = Number(checkout.amount);
    const currency = checkout.currency || "GNF";
    const payment = {
      status: "yes",
      method: payment_method,
      reference: `DB-${Date.now()}`,
      amount,
      currency,
      charged_at: new Date().toISOString(),
    };

    const orderId = randomUUID();
    const purchaseBody = {
      order_id: orderId,
      amount,
      currency,
      payment_method,
      payment_reference: payment.reference,
      hold_ids: holdIds,
      customer: {
        name: customer?.name || "Demo Booking Fan",
        phone: customer?.phone || "+224620000000",
        email: customer?.email || "fan@example.com",
      },
    };

    try {
      const purchaseRes = await stadepassRequest({
        method: "POST",
        path: "/api/v1/public/purchases",
        body: purchaseBody,
      });

      const purchase = purchaseRes.data || purchaseRes;
      const tickets = purchase.tickets || purchase.data?.tickets || [];
      const purchaseOut = {
        ...purchase,
        tickets,
        order_id: purchase.order_id || orderId,
      };
      saveOrder({
        order_id: purchaseOut.order_id,
        demo: isDemoMode(),
        event_id: checkout.event_id,
        event_title,
        amount,
        currency,
        payment_reference: payment.reference,
        tickets,
      });
      return res.json({
        success: true,
        demo: isDemoMode(),
        payment,
        checkout,
        purchase: purchaseOut,
      });
    } catch (e) {
      const err = new Error(e.message || "Purchase failed");
      err.status = e.status || 500;
      err.payload = {
        ...(e.payload || {}),
        sent_to_core: purchaseBody,
        checkout_summary: {
          amount: checkout.amount,
          hold_ids: holdIds,
        },
      };
      throw err;
    }
  } catch (e) {
    next(e);
  }
});

export default router;
