async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  // Guide: DELETE release-hold has no body — omit content-type.
  if (options.body != null && options.body !== "") {
    headers["content-type"] = headers["content-type"] || "application/json";
  }
  const res = await fetch(path, {
    ...options,
    headers,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || json.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}

/**
 * Partner BFF → Core Public API (guide only):
 * 1 GET  /events
 * 2 POST /booking-sessions { event_id, access_code }
 * 3 GET  /booking-sessions/:id?section_id=
 * 4 POST /booking-sessions/:id/holds { seat_id, section_id? }
 * 5 DELETE /booking-sessions/:id/holds/:holdId
 * 6 GET  /booking-sessions/:id/checkout
 * 7 POST /purchases { order_id, amount, currency, payment_method, payment_reference, hold_ids, customer }
 */
export const api = {
  health: () => request("/api/health"),
  getMode: () => request("/api/mode"),
  setMode: (body) =>
    request("/api/mode", { method: "POST", body: JSON.stringify(body) }),
  listEvents: (params = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ""))
    ).toString();
    return request(`/api/events${qs ? `?${qs}` : ""}`);
  },
  createSession: (body) =>
    request("/api/booking-sessions", { method: "POST", body: JSON.stringify(body) }),
  getSession: (sessionId, sectionId) => {
    const qs = sectionId ? `?section_id=${encodeURIComponent(sectionId)}` : "";
    return request(`/api/booking-sessions/${sessionId}${qs}`);
  },
  getSeats: (sessionId, sectionId) =>
    request(`/api/booking-sessions/${sessionId}?section_id=${encodeURIComponent(sectionId)}`),
  createHold: (sessionId, seatId, extra = {}) =>
    request(`/api/booking-sessions/${sessionId}/holds`, {
      method: "POST",
      body: JSON.stringify({
        seat_id: String(seatId),
        ...(extra.section_id != null && String(extra.section_id) !== ""
          ? { section_id: String(extra.section_id) }
          : {}),
      }),
    }),
  releaseHold: (sessionId, holdId) =>
    request(`/api/booking-sessions/${sessionId}/holds/${holdId}`, { method: "DELETE" }),
  checkout: (sessionId) => request(`/api/booking-sessions/${sessionId}/checkout`),
  pay: (body) =>
    request("/api/payments/pay", {
      method: "POST",
      body: JSON.stringify({ payment_status: "yes", ...body }),
    }),
  listTickets: () => request("/api/tickets"),
  getTicket: (id) => request(`/api/tickets/${encodeURIComponent(id)}`),
};
