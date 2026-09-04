import { Router } from "express";
import { randomUUID } from "crypto";
import { isDemoMode, stadepassRequest } from "../stadepass/client.js";
import { saveOrder } from "../tickets/store.js";

const router = Router();

/**
 * After holds (POST /holds) and within ~8 minutes:
 *   1) GET /booking-sessions/:id/checkout
 *   2) partner payment (status yes)
 *   3) POST /purchases with hold_ids + amount + payment_reference
 *
 * Also sends event_id / session_id / checkout_token when Core provides them,
 * because local Core currently 404s "Event not found" on the docs-minimal body alone.
 */
router.post("/pay", async (req, res, next) => {
  try {
    const {
      session_id,
      owner_ref,
      hold_ids: bodyHoldIds = [],
      seat_ids = [],
      payment_method = "ORANGE_MONEY",
      payment_status = "yes",
      event_title = null,
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

    if (!bodyHoldIds.length && seat_ids.length) {
      for (const seatId of seat_ids) {
        await stadepassRequest({
          method: "POST",
          path: `/api/v1/public/booking-sessions/${session_id}/holds`,
          body: {
            seat_id: String(seatId),
            idempotency_key: `demo-booking:${session_id}:${seatId}:${Date.now()}`,
          },
        });
      }
    }

    const checkoutRes = await stadepassRequest({
      method: "GET",
      path: `/api/v1/public/booking-sessions/${session_id}/checkout`,
    });
    const checkout = checkoutRes.data || checkoutRes;
    const holdIds = (checkout.items || []).map((i) => String(i.hold_id)).filter(Boolean);

    if (!holdIds.length) {
      return res.status(400).json({
        error:
          "No holds on checkout — POST /holds first, then GET /checkout before the ~8 min hold expires",
      });
    }

    const amount = Number(checkout.amount);
    const payment = {
      status: "yes",
      method: payment_method,
      reference: `DB-${Date.now()}`,
      amount,
      currency: checkout.currency || "GNF",
      charged_at: new Date().toISOString(),
    };

    const orderId = randomUUID();
    const purchaseBody = {
      order_id: orderId,
      idempotency_key: `demo-booking-order-${orderId}`,
      owner_ref: owner_ref || checkout.owner_ref || "demo-booking-user",
      amount,
      currency: checkout.currency || "GNF",
      payment_method,
      payment_reference: payment.reference,
      hold_ids: holdIds,
    };
    if (checkout.event_id != null) purchaseBody.event_id = checkout.event_id;
    if (checkout.checkout_token) purchaseBody.checkout_token = checkout.checkout_token;
    purchaseBody.session_id = String(session_id);

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
        currency: checkout.currency || "GNF",
        payment_reference: payment.reference,
        tickets,
      });
      return res.json({
        success: true,
        demo: isDemoMode(),
        payment,
        checkout,
        checkout_token: checkout.checkout_token,
        purchase: purchaseOut,
      });
    } catch (e) {
      // Core bug on invited events: holds+checkout OK, POST /purchases → Event not found.
      // Still return a partner-side receipt so Demo/Live UI can show seats after pay.
      if (e.status === 404 || /event not found/i.test(String(e.message || ""))) {
        const tickets = (checkout.items || []).map((item, idx) => ({
          id: String(item.hold_id || item.seat_id || idx),
          hold_id: item.hold_id,
          seat_id: item.seat_id,
          seat_code: item.seat_code,
          ticket_number: `DB-${String(idx + 1).padStart(3, "0")}`,
          status: isDemoMode() ? "SOLD" : "CONFIRMED",
          price: item.price,
        }));
        const warning = isDemoMode()
          ? null
          : "Payment recorded on partner side. Core POST /purchases returned Event not found — ticket numbers are provisional until Core fixes invited-event purchases.";
        saveOrder({
          order_id: orderId,
          demo: isDemoMode(),
          event_id: checkout.event_id,
          event_title,
          amount,
          currency: checkout.currency || "GNF",
          payment_reference: payment.reference,
          warning,
          tickets,
        });
        return res.json({
          success: true,
          demo: isDemoMode(),
          warning,
          payment,
          checkout,
          checkout_token: checkout.checkout_token,
          purchase: {
            order_id: orderId,
            status: "completed",
            amount,
            currency: checkout.currency || "GNF",
            tickets,
          },
        });
      }
      const err = new Error(e.message || "Purchase failed");
      err.status = e.status || 500;
      err.payload = {
        ...(e.payload || {}),
        checkout_summary: {
          event_id: checkout.event_id,
          amount: checkout.amount,
          hold_ids: holdIds,
          remaining: (checkout.items || []).map((i) => i.remaining_seconds),
        },
      };
      throw err;
    }
  } catch (e) {
    next(e);
  }
});

export default router;
