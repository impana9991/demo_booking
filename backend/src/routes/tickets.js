import { Router } from "express";
import { listOrders } from "../tickets/store.js";
import { isDemoMode } from "../stadepass/client.js";

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

export default router;
