import { randomUUID } from "crypto";

/** In-memory demo inventory mirroring partner invite + event-secret rules. */
const DEMO_ACCESS = process.env.STADEPASS_EVENT_ACCESS_CODE || "demo-access";

const demoState = {
  holds: new Map(),
  soldSeats: new Set(),
  sessions: new Map(),
};

const EVENTS = [
  {
    id: "1",
    title: "Horoya AC — Hafia FC",
    category: "Sport",
    starts_at: "2026-09-28T16:00:00",
    venue: { name: "Stade du 28 Septembre", city: "Conakry", country: "Guinée" },
    min_price: 50000,
    currency: "GNF",
    home_team: "Horoya AC",
    away_team: "Hafia FC",
    description: "Derby de Conakry — invited event for Demo Booking.",
    invited: true,
    pricing_zones: [
      { name: "Tribune Ouest", price: 50000, currency: "GNF" },
      { name: "Tribune Est", price: 35000, currency: "GNF" },
    ],
  },
  {
    id: "2",
    title: "Concert — Stars de Conakry",
    category: "Concert",
    starts_at: "2026-10-12T20:00:00",
    venue: { name: "Stade du 28 Septembre", city: "Conakry", country: "Guinée" },
    min_price: 75000,
    currency: "GNF",
    home_team: null,
    away_team: null,
    description: "Soirée live — Demo Booking invite + event secret required.",
    invited: true,
    pricing_zones: [{ name: "Tribune Ouest", price: 75000, currency: "GNF" }],
  },
];

const MAP = {
  event_id: "1",
  zones: [
    {
      id: "10",
      name: "Tribune Ouest",
      code: "TRIB-OUEST",
      price: 50000,
      sections: [
        { id: "12", name: "Bloc A", code: "A" },
        { id: "13", name: "Bloc B", code: "B" },
      ],
    },
    {
      id: "11",
      name: "Tribune Est",
      code: "TRIB-EST",
      price: 35000,
      sections: [{ id: "21", name: "Bloc C", code: "C" }],
    },
  ],
};

function buildSeats(sectionId) {
  const section = MAP.zones.flatMap((z) => z.sections).find((s) => s.id === sectionId);
  const code = section?.code || "X";
  const zone = MAP.zones.find((z) => z.sections.some((s) => s.id === sectionId));
  const price = zone?.price || 50000;
  const seats = [];
  let id = Number(sectionId) * 100;
  for (let row = 1; row <= 4; row++) {
    for (let n = 1; n <= 8; n++) {
      id += 1;
      const seatId = String(id);
      const seatCode = `${code}${row}-${n}`;
      let status = "available";
      if (demoState.soldSeats.has(seatId)) status = "sold";
      else {
        for (const h of demoState.holds.values()) {
          if (h.seat_id === seatId && h.status === "held" && new Date(h.expires_at) > new Date()) {
            status = "held";
            break;
          }
        }
      }
      seats.push({ seat_id: seatId, seat_code: seatCode, status, price, currency: "GNF", section_id: sectionId });
    }
  }
  return seats;
}

function sessionHolds(sessionId) {
  const now = Date.now();
  const list = [];
  for (const [id, h] of demoState.holds) {
    if (h.session_id !== sessionId) continue;
    if (h.status !== "held") continue;
    const remaining = Math.max(0, Math.floor((new Date(h.expires_at).getTime() - now) / 1000));
    if (remaining <= 0) {
      h.status = "expired";
      continue;
    }
    list.push({ ...h, remaining_seconds: remaining });
  }
  return list;
}

function bad(status, message) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

export async function demoRequest({ method, path, query = {}, body = null }) {
  const m = method.toUpperCase();

  if (m === "GET" && path === "/api/v1/public/events") {
    let events = EVENTS.filter((e) => e.invited);
    if (query.category) events = events.filter((e) => e.category === query.category);
    if (query.q) {
      const q = String(query.q).toLowerCase();
      events = events.filter((e) => e.title.toLowerCase().includes(q));
    }
    return {
      data: {
        events: events.map(({ description, pricing_zones, invited, ...e }) => e),
        pagination: { page: 1, limit: 12, total: events.length, total_pages: 1 },
      },
    };
  }

  const eventMatch = path.match(/^\/api\/v1\/public\/events\/([^/]+)$/);
  if (m === "GET" && eventMatch) {
    const ev = EVENTS.find((e) => e.id === eventMatch[1] && e.invited);
    if (!ev) bad(404, "Event not found (partner not invited)");
    return { success: true, data: ev };
  }

  const mapMatch = path.match(/^\/api\/v1\/public\/events\/([^/]+)\/map$/);
  if (m === "GET" && mapMatch) {
    const ev = EVENTS.find((e) => e.id === mapMatch[1] && e.invited);
    if (!ev) bad(404, "Event not found (partner not invited)");
    return { success: true, data: { ...MAP, event_id: mapMatch[1] } };
  }

  if (m === "POST" && path === "/api/v1/public/booking-sessions") {
    if (!body?.access_code) bad(400, "access_code is required");
    if (String(body.access_code) !== DEMO_ACCESS) {
      bad(403, "Invalid access_code — invite secret does not match");
    }
    const eventId = String(body?.event_id || "");
    const ev = EVENTS.find((e) => e.id === eventId && e.invited);
    if (!ev) bad(404, "Event not found or partner not invited");

    const sessionId = randomUUID();
    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const session = {
      session_id: sessionId,
      event_id: eventId,
      owner_ref: body?.owner_ref || "demo-user",
      status: "ACTIVE",
      expires_at: expires,
      requires_access_code: true,
    };
    demoState.sessions.set(sessionId, session);
    return { success: true, message: "Booking session created", data: session };
  }

  const sessionMatch = path.match(/^\/api\/v1\/public\/booking-sessions\/([^/]+)$/);
  if (m === "GET" && sessionMatch) {
    const sessionId = sessionMatch[1];
    if (!demoState.sessions.has(sessionId)) bad(404, "Session not found");
    const sectionId = query.section_id;
    if (sectionId) {
      return {
        success: true,
        data: {
          availability: {
            scope: "section",
            section_id: String(sectionId),
            seats: buildSeats(String(sectionId)),
          },
          holds: sessionHolds(sessionId),
        },
      };
    }
    return {
      success: true,
      data: {
        availability: { scope: "overview", zones: MAP.zones },
        holds: sessionHolds(sessionId),
      },
    };
  }

  const holdCreate = path.match(/^\/api\/v1\/public\/booking-sessions\/([^/]+)\/holds$/);
  if (m === "POST" && holdCreate) {
    const sessionId = holdCreate[1];
    if (!demoState.sessions.has(sessionId)) bad(404, "Session not found");
    const seatId = String(body?.seat_id);
    if (demoState.soldSeats.has(seatId)) bad(409, "Seat already sold");
    for (const h of demoState.holds.values()) {
      if (h.seat_id === seatId && h.status === "held" && new Date(h.expires_at) > new Date()) {
        bad(409, "Seat already held");
      }
    }
    const seats = ["12", "13", "21"].flatMap((sid) => buildSeats(sid));
    const seat = seats.find((s) => s.seat_id === seatId) || {
      seat_id: seatId,
      seat_code: "A-12",
      price: 50000,
      section_id: "12",
    };
    const holdId = randomUUID();
    const expiresAt = new Date(Date.now() + 8 * 60 * 1000).toISOString();
    const hold = {
      id: holdId,
      session_id: sessionId,
      event_id: demoState.sessions.get(sessionId)?.event_id || "1",
      seat_id: seatId,
      status: "held",
      expires_at: expiresAt,
      remaining_seconds: 480,
      price: seat.price || 50000,
      currency: "GNF",
      seat_code: seat.seat_code,
      section_id: seat.section_id,
    };
    demoState.holds.set(holdId, hold);
    return { success: true, data: { session_id: sessionId, hold } };
  }

  const holdDelete = path.match(/^\/api\/v1\/public\/booking-sessions\/([^/]+)\/holds\/([^/]+)$/);
  if (m === "DELETE" && holdDelete) {
    const hold = demoState.holds.get(holdDelete[2]);
    if (hold) hold.status = "released";
    return { success: true, message: "Hold released" };
  }

  const checkoutMatch = path.match(/^\/api\/v1\/public\/booking-sessions\/([^/]+)\/checkout$/);
  if (m === "GET" && checkoutMatch) {
    const sessionId = checkoutMatch[1];
    const items = sessionHolds(sessionId).map((h) => ({
      hold_id: h.id,
      seat_id: h.seat_id,
      seat_code: h.seat_code,
      price: h.price,
      remaining_seconds: h.remaining_seconds,
    }));
    const amount = items.reduce((s, i) => s + i.price, 0);
    return {
      success: true,
      data: {
        session_id: sessionId,
        event_id: demoState.sessions.get(sessionId)?.event_id || "1",
        amount,
        currency: "GNF",
        items,
        checkout_token: `demo-checkout-${sessionId}`,
        next_step: "collect_payment_on_partner_side",
      },
    };
  }

  if (m === "POST" && path === "/api/v1/public/purchases") {
    const holdIds = body?.hold_ids || [];
    const tickets = [];
    for (const hid of holdIds) {
      const h = demoState.holds.get(hid);
      if (!h || h.status !== "held") continue;
      h.status = "sold";
      demoState.soldSeats.add(h.seat_id);
      tickets.push({
        id: String(900 + tickets.length + 1),
        hold_id: hid,
        event_id: h.event_id,
        seat_id: h.seat_id,
        ticket_number: `TCK-${String(tickets.length + 1).padStart(3, "0")}`,
        status: "SOLD",
        seat_code: h.seat_code,
      });
    }
    return {
      success: true,
      data: {
        order_id: body?.order_id || randomUUID(),
        status: "completed",
        amount: body?.amount || 0,
        currency: "GNF",
        tickets,
      },
    };
  }

  bad(404, `Demo handler missing for ${m} ${path}`);
}
