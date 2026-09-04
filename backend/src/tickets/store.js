/** In-memory ticket/order store for Demo Booking dashboard. */
const orders = [];

export function saveOrder(order) {
  const row = {
    id: order.order_id || order.id || `ord-${Date.now()}`,
    created_at: order.created_at || new Date().toISOString(),
    demo: Boolean(order.demo),
    event_id: order.event_id || null,
    event_title: order.event_title || null,
    amount: order.amount ?? null,
    currency: order.currency || "GNF",
    payment_reference: order.payment_reference || null,
    warning: order.warning || null,
    tickets: Array.isArray(order.tickets) ? order.tickets : [],
  };
  // newest first
  orders.unshift(row);
  // keep last 200
  if (orders.length > 200) orders.length = 200;
  return row;
}

export function listOrders() {
  return orders.slice();
}
