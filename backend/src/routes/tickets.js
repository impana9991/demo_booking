import { Router } from "express";
import { listOrders } from "../tickets/store.js";
import { isDemoMode, stadepassRequest } from "../stadepass/client.js";

const router = Router();

/** Partner dashboard: tickets/orders created through this app. */
router.get("/", (_req, res) => {
  const orders = listOrders();
  res.json({
    success: true,
    demo: isDemoMode(),
    data: {
      orders,
      tickets: orders.flatMap((o) =>
        (o.tickets || []).map((t) => ({
          ...t,
          order_id: o.id,
          event_title: o.event_title,
          event_id: o.event_id,
          created_at: o.created_at,
          payment_reference: o.payment_reference,
        }))
      ),
    },
  });
});

/**
 * Guide: GET /api/v1/public/tickets/:id — same ticket + qr shape as purchase.
 * Falls back to local store when Demo or Core has no route yet.
 */
router.get("/:ticketId", async (req, res, next) => {
  try {
    const ticketId = String(req.params.ticketId);

    if (!isDemoMode()) {
      try {
        const data = await stadepassRequest({
          method: "GET",
          path: `/api/v1/public/tickets/${ticketId}`,
        });
        return res.json({ demo: false, ...data });
      } catch (e) {
        // If Core ticket detail isn't deployed yet, fall through to local cache.
        if (e.status !== 404) throw e;
      }
    }

    const local = listOrders()
      .flatMap((o) => (o.tickets || []).map((t) => ({ ...t, order_id: o.id, event_title: o.event_title })))
      .find((t) => String(t.id) === ticketId || String(t.ticket_number) === ticketId);

    if (!local) {
      return res.status(404).json({ success: false, error: "Ticket not found" });
    }

    res.json({
      success: true,
      demo: isDemoMode(),
      data: local,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
