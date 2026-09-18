import { randomUUID } from "crypto";

/** In-memory demo inventory — map shape matches Core (zones/sections/seats geometry). */
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
    min_price: 35000,
    currency: "GNF",
    home_team: "Horoya AC",
    away_team: "Hafia FC",
    description: "Derby de Conakry — Demo Booking sample event.",
    invited: true,
    pricing_zones: [
      { name: "Tribune Ouest", code: "TRIB-OUEST", price: 50000, currency: "GNF" },
      { name: "Tribune Est", code: "TRIB-EST", price: 35000, currency: "GNF" },
      { name: "Tribune Nord", code: "TRIB-NORD", price: 45000, currency: "GNF" },
      { name: "Tribune Sud", code: "TRIB-SUD", price: 40000, currency: "GNF" },
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
    description: "Soirée live — Demo Booking sample concert.",
    invited: true,
    pricing_zones: [{ name: "Tribune Ouest", code: "TRIB-OUEST", price: 75000, currency: "GNF" }],
  },
];

function polar(r, deg) {
  const rad = (deg * Math.PI) / 180;
  return [r * Math.cos(rad), r * Math.sin(rad)];
}

/** Build Visafans-style map payload (same fields Core returns). */
function buildMap(eventId) {
  const zoneDefs = [
    { id: "10", name: "Tribune Ouest", code: "TRIB-OUEST", price: 50000, color: "#16A34A", start: 200, end: 340, inner: 520, outer: 980 },
    { id: "11", name: "Tribune Est", code: "TRIB-EST", price: 35000, color: "#2563EB", start: 20, end: 160, inner: 520, outer: 980 },
    { id: "14", name: "Tribune Nord", code: "TRIB-NORD", price: 45000, color: "#DC2626", start: 340, end: 380, inner: 520, outer: 920 },
    { id: "15", name: "Tribune Sud", code: "TRIB-SUD", price: 40000, color: "#CA8A04", start: 160, end: 200, inner: 520, outer: 920 },
  ];

  const zones = [];
  const sections = [];
  const seats = [];

  for (const z of zoneDefs) {
    const end = z.end > 360 ? z.end - 360 : z.end;
    zones.push({
      id: z.id,
      name: z.name,
      code: z.code,
      price: z.price,
      sales_price_num: z.price,
      currency: "GNF",
      display_color: z.color,
      start_angle: z.start > 360 ? z.start - 360 : z.start,
      end_angle: end,
      inner_radius: z.inner,
      outer_radius: z.outer,
      sales_available_seats: 64,
    });

    const span = (z.end - z.start) / 2;
    for (let i = 0; i < 2; i++) {
      const secStart = z.start + i * span;
      const secEnd = secStart + span;
      const secId = String(Number(z.id) * 10 + i + 1);
      const code = `${z.code.replace("TRIB-", "")}${i + 1}`;
      sections.push({
        id: secId,
        zone_id: z.id,
        name: `Bloc ${code}`,
        code,
        price: z.price,
        display_color: z.color,
        start_angle: secStart > 360 ? secStart - 360 : secStart,
        end_angle: secEnd > 360 ? secEnd - 360 : secEnd,
        inner_radius: z.inner + 40,
        outer_radius: z.outer - 40,
      });

      // 4 rows × 8 seats — shape matches Core PublicMapSeatDto (places-restantes fields).
      const rowLetters = ["A", "B", "C", "D"];
      const porteLib = z.name.replace(/^Tribune\s+/i, "") || z.code;
      const porte = {
        code: `PORTE-${z.code.replace("TRIB-", "")}`,
        nom: `Porte ${porteLib}`,
        libelle: porteLib,
      };
      const tribune = { code: z.code, nom: z.name, couleur: z.color };
      let n = 0;
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 8; col++) {
          n += 1;
          const t = (col + 0.5) / 8;
          const deg = secStart + t * span;
          const r = z.inner + 80 + row * ((z.outer - z.inner - 120) / 3);
          const [x, y] = polar(r, deg);
          const seatId = `${secId}${String(n).padStart(2, "0")}`;
          const rangee = rowLetters[row];
          const numero = col + 1;
          const place = `${rangee}${numero}`;
          const seat_code = `${code}-${rangee}${numero}`;
          const route = [`Enter ${porte.nom}`, `Section ${code}`, `Row ${rangee}`, `Seat ${place}`];
          seats.push({
            id: seatId,
            seat_id: seatId,
            section_id: secId,
            zone_id: z.id,
            seat_code,
            row: row + 1,
            number: numero,
            position_x: x,
            position_y: y,
            price: z.price,
            currency: "GNF",
            status: "available",
            is_accessible: false,
            display_color: z.color,
            place_id: seatId,
            place,
            numero_place: numero,
            rangee,
            secteur: null,
            porte,
            tribune,
            route,
            route_texte: route.join(" → "),
          });
        }
      }
    }
  }

  return {
    event_id: String(eventId),
    stadium: { name: "Stade du 28 Septembre", city: "Conakry" },
    zones,
    sections,
    seats,
  };
}

const MAP_BY_EVENT = {
  1: buildMap("1"),
  2: buildMap("2"),
};

function mapFor(eventId) {
  return MAP_BY_EVENT[String(eventId)] || MAP_BY_EVENT["1"];
}

function seatStatus(seatId) {
  if (demoState.soldSeats.has(seatId)) return "sold";
  for (const h of demoState.holds.values()) {
    if (h.seat_id === seatId && h.status === "held" && new Date(h.expires_at) > new Date()) {
      return "held";
    }
  }
  return "available";
}

function buildSeats(eventId, sectionId) {
  const map = mapFor(eventId);
  return map.seats
    .filter((s) => String(s.section_id) === String(sectionId))
    .map((s) => ({
      ...s,
      seat_id: String(s.id),
      id: String(s.id),
      place_id: String(s.place_id || s.id),
      status: seatStatus(String(s.id)),
      currency: "GNF",
      section_id: String(s.section_id),
      zone_id: String(s.zone_id),
    }));
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

function accessOk(code) {
  const c = String(code || "");
  return c === DEMO_ACCESS || c === "demo-access" || c.length > 0;
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
      success: true,
      data: {
        events: events.map(({ description, pricing_zones, invited, ...e }) => e),
        pagination: { page: 1, limit: 12, total: events.length, total_pages: 1 },
      },
    };
  }

  // Guide has no GET /events/:id or GET /events/:id/map — map comes from POST /booking-sessions.

  if (m === "POST" && path === "/api/v1/public/booking-sessions") {
    if (!accessOk(body?.access_code)) bad(403, "Invalid access_code — invite secret does not match");
    const eventId = String(body?.event_id || "");
    const ev = EVENTS.find((e) => e.id === eventId && e.invited);
    if (!ev) bad(404, "Event not found or partner not invited");

    const sessionId = randomUUID();
    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const map = mapFor(eventId);
    const session = {
      session_id: sessionId,
      event_id: eventId,
      status: "ACTIVE",
      expires_at: expires,
      requires_access_code: true,
    };
    demoState.sessions.set(sessionId, session);
    // Guide: reply includes event + stadium map (zones / sections / seats).
    return {
      success: true,
      message: "Booking session created",
      data: {
        ...session,
        event: {
          id: ev.id,
          title: ev.title,
          min_price: ev.min_price,
          currency: ev.currency,
          pricing: {
            currency: ev.currency,
            min_price: ev.min_price,
            zones: (ev.pricing_zones || []).map((z) => ({
              name: z.name,
              code: z.code,
              price: z.price,
            })),
          },
          availability: { status: "available", remaining: map.seats?.length || 0 },
        },
        map,
        availability: {
          event_id: eventId,
          scope: "overview",
          sold_out: false,
          remaining: map.seats?.length || 0,
          zones: map.zones.map((z) => ({ id: z.id, remaining: z.sales_available_seats })),
          sections: map.sections.map((s) => ({
            id: s.id,
            zone_id: s.zone_id,
            code: s.code,
            name: s.name,
            remaining: 32,
          })),
        },
        holds: [],
      },
    };
  }

  const sessionMatch = path.match(/^\/api\/v1\/public\/booking-sessions\/([^/]+)$/);
  if (m === "GET" && sessionMatch) {
    const sessionId = sessionMatch[1];
    const session = demoState.sessions.get(sessionId);
    if (!session) bad(404, "Session not found");
    const sectionId = query.section_id;
    if (sectionId) {
      return {
        success: true,
        data: {
          availability: {
            scope: "section",
            section_id: String(sectionId),
            seats: buildSeats(session.event_id, String(sectionId)),
          },
          holds: sessionHolds(sessionId),
        },
      };
    }
    const map = mapFor(session.event_id);
    return {
      success: true,
      data: {
        availability: { scope: "overview", zones: map.zones },
        holds: sessionHolds(sessionId),
      },
    };
  }

  const holdCreate = path.match(/^\/api\/v1\/public\/booking-sessions\/([^/]+)\/holds$/);
  if (m === "POST" && holdCreate) {
    const sessionId = holdCreate[1];
    const session = demoState.sessions.get(sessionId);
    if (!session) bad(404, "Session not found");
    const seatId = String(body?.seat_id);
    if (demoState.soldSeats.has(seatId)) bad(409, "Seat already sold");
    for (const h of demoState.holds.values()) {
      if (h.seat_id === seatId && h.status === "held" && new Date(h.expires_at) > new Date()) {
        bad(409, "Seat already held");
      }
    }
    const map = mapFor(session.event_id);
    const seat = map.seats.find((s) => String(s.id) === seatId);
    if (!seat) bad(404, "Seat not found");
    const section = map.sections.find((sec) => String(sec.id) === String(seat.section_id));
    const holdId = randomUUID();
    const expiresAt = new Date(Date.now() + 8 * 60 * 1000).toISOString();
    const hold = {
      id: holdId,
      session_id: sessionId,
      event_id: session.event_id,
      seat_id: seatId,
      place_id: seat.place_id || seatId,
      status: "held",
      expires_at: expiresAt,
      remaining_seconds: 480,
      price: seat.price,
      currency: "GNF",
      seat_code: seat.seat_code,
      place: seat.place,
      rangee: seat.rangee,
      numero_place: seat.numero_place,
      section_code: section?.code || null,
      section_id: String(seat.section_id),
      zone_id: String(seat.zone_id),
      porte: seat.porte || null,
      tribune: seat.tribune || null,
      route_texte: seat.route_texte || null,
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
    const session = demoState.sessions.get(sessionId);
    if (!session) bad(404, "Session not found");
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
        event_id: session.event_id,
        amount,
        currency: "GNF",
        items,
        next_step: "collect_payment_on_partner_side",
      },
    };
  }

  if (m === "POST" && path === "/api/v1/public/purchases") {
    // Guide: order_id, amount, currency, payment_method, payment_reference, hold_ids, customer
    if (!body?.order_id || body?.amount == null || !body?.currency || !body?.payment_method || !body?.payment_reference) {
      bad(400, "Missing purchase fields (order_id, amount, currency, payment_method, payment_reference, hold_ids, customer)");
    }
    if (!body?.customer?.name) bad(400, "customer.name is required");
    const holdIds = body?.hold_ids || [];
    const tickets = [];
    for (const hid of holdIds) {
      const h = demoState.holds.get(hid);
      if (!h || h.status !== "held") continue;
      h.status = "sold";
      demoState.soldSeats.add(h.seat_id);
      const code = `GN28-DEMO${String(tickets.length + 1).padStart(4, "0")}`;
      // Demo stand-in for Core qr.image_url (Live: Cloudinary HTTPS).
      const tinyPng =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      tickets.push({
        id: String(900 + tickets.length + 1),
        hold_id: hid,
        event_id: h.event_id,
        seat_id: h.seat_id,
        ticket_code: code,
        ticket_number: `TK-2026-${String(tickets.length + 1).padStart(3, "0")}-GN`,
        status: "SOLD",
        seat_code: h.seat_code,
        ...(h.section_code ? { section_code: h.section_code } : {}),
        ...(h.rangee ? { row: h.rangee } : {}),
        ...(h.numero_place != null ? { seat_number: String(h.numero_place) } : {}),
        ...(h.porte ? { porte: h.porte } : {}),
        ...(h.route_texte ? { route_texte: h.route_texte } : {}),
        qr: {
          payload: code,
          image_url: tinyPng,
        },
      });
    }
    if (!tickets.length) bad(400, "No valid holds to purchase");
    return {
      success: true,
      data: {
        order_id: body.order_id,
        status: "completed",
        amount: body.amount,
        currency: body.currency || "GNF",
        customer: body.customer,
        tickets,
      },
    };
  }

  const ticketMatch = path.match(/^\/api\/v1\/public\/tickets\/([^/]+)$/);
  if (m === "GET" && ticketMatch) {
    bad(404, `Ticket ${ticketMatch[1]} not found`);
  }

  bad(404, `Demo handler missing for ${m} ${path}`);
}
