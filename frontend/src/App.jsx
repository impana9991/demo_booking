import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import StadiumVenue, { SectionList, formatGnf as formatGnfVenue, zonePrice } from "./StadiumVenue";

function formatGnf(amount) {
  return formatGnfVenue(amount);
}

/** Place seats in the section ring when Core/availability has no position_x/y. */
function layoutSectionSeats(section, liveSeats) {
  if (!Array.isArray(liveSeats) || !liveSeats.length) return [];

  const withGeo = liveSeats.every(
    (s) => Number.isFinite(Number(s.position_x)) && Number.isFinite(Number(s.position_y))
  );
  if (withGeo) {
    return liveSeats.map((s) => ({
      ...s,
      id: String(s.seat_id || s.id),
      seat_id: String(s.seat_id || s.id),
      section_id: String(s.section_id || section?.id || ""),
    }));
  }

  const cols = Math.max(8, Math.ceil(Math.sqrt(liveSeats.length * 1.6)));
  const rows = Math.max(1, Math.ceil(liveSeats.length / cols));
  const start = Number(section?.start_angle);
  const endRaw = Number(section?.end_angle);
  const hasArc =
    Number.isFinite(start) &&
    Number.isFinite(endRaw) &&
    Number.isFinite(Number(section?.inner_radius)) &&
    Number.isFinite(Number(section?.outer_radius));

  let sweepEnd = endRaw;
  if (hasArc && sweepEnd < start) sweepEnd += 360;
  const inner = hasArc ? Number(section.inner_radius) + 30 : 0;
  const outer = hasArc ? Number(section.outer_radius) - 20 : 0;

  return liveSeats.map((s, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const id = String(s.seat_id || s.id);
    let position_x;
    let position_y;
    if (hasArc) {
      const t = (col + 0.5) / cols;
      const deg = start + t * (sweepEnd - start);
      const r = inner + ((row + 0.5) / rows) * Math.max(80, outer - inner);
      const rad = (deg * Math.PI) / 180;
      position_x = r * Math.cos(rad);
      position_y = r * Math.sin(rad);
    } else {
      position_x = (col - (cols - 1) / 2) * 56;
      position_y = (row - (rows - 1) / 2) * 56;
    }
    return {
      ...s,
      id,
      seat_id: id,
      seat_code: s.seat_code || id,
      section_id: String(s.section_id || section?.id || ""),
      zone_id: s.zone_id != null ? String(s.zone_id) : section?.zone_id != null ? String(section.zone_id) : undefined,
      status: s.status || "available",
      price: s.price,
      position_x,
      position_y,
    };
  });
}

function eventMinPrice(ev) {
  return ev?.min_price ?? ev?.pricing?.min_price ?? null;
}

function eventPriceZones(ev, mapZones = []) {
  const fromEvent = ev?.pricing?.zones || ev?.pricing_zones;
  if (Array.isArray(fromEvent) && fromEvent.length) {
    return fromEvent.map((z) => ({
      name: z.name,
      code: z.code,
      price: z.price ?? z.sales_price_num ?? null,
      currency: z.currency || ev?.currency || ev?.pricing?.currency || "GNF",
    }));
  }
  return (mapZones || []).map((z) => ({
    name: z.name,
    code: z.code,
    price: z.price ?? z.sales_price_num ?? null,
    currency: "GNF",
  }));
}

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatShort(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const VIEWS = {
  events: "events",
  detail: "detail",
  map: "map",
  checkout: "checkout",
  success: "success",
  tickets: "tickets",
};

const FLOW = ["Events", "Details", "Seats", "Pay", "Done"];
const TICKETS_KEY = "demo-booking-tickets";
const LIVE_PARTNER_KEY = "demo-booking-live-partner";

function loadLocalOrders() {
  try {
    const raw = localStorage.getItem(TICKETS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalOrder(order) {
  const prev = loadLocalOrders();
  const next = [order, ...prev.filter((o) => o.id !== order.id)].slice(0, 100);
  localStorage.setItem(TICKETS_KEY, JSON.stringify(next));
  return next;
}

export default function App() {
  const [view, setView] = useState(VIEWS.events);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [events, setEvents] = useState([]);
  const [event, setEvent] = useState(null);
  const [map, setMap] = useState(null);
  const [session, setSession] = useState(null);
  const [sectionId, setSectionId] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [mapStep, setMapStep] = useState("zones");
  const [ticketCount, setTicketCount] = useState(2);
  const [selected, setSelected] = useState([]);
  const [seatStatusById, setSeatStatusById] = useState({});
  const [checkout, setCheckout] = useState(null);
  const [seatsLoading, setSeatsLoading] = useState(false);
  const [holdBusy, setHoldBusy] = useState(false);
  const [paying, setPaying] = useState(false);
  const [result, setResult] = useState(null);
  const [mode, setMode] = useState("demo");
  const [modeBusy, setModeBusy] = useState(false);
  const [showLiveForm, setShowLiveForm] = useState(false);
  const [partnerCode, setPartnerCode] = useState("");
  const [eventAccessCode, setEventAccessCode] = useState("");
  const [openingMap, setOpeningMap] = useState(false);
  const [orders, setOrders] = useState(() => loadLocalOrders());
  /** Full seat geometry kept out of React state (Live maps are ~20k seats). */
  const allSeatsRef = useRef([]);

  useEffect(() => {
    (async () => {
      try {
        const savedPartner = sessionStorage.getItem(LIVE_PARTNER_KEY) || "";
        if (savedPartner) {
          try {
            const live = await api.setMode({ mode: "live", partner_code: savedPartner });
            setMode(live.mode || "live");
            setPartnerCode(savedPartner);
          } catch {
            sessionStorage.removeItem(LIVE_PARTNER_KEY);
            setMode("demo");
          }
        } else {
          const m = await api.getMode();
          setMode(m.mode || (m.demo ? "demo" : "live"));
        }
      } catch {
        setMode("demo");
      }
      loadEvents();
    })();
  }, []);

  function syncModeFromResponse(res) {
    if (typeof res?.demo === "boolean") {
      const next = res.demo ? "demo" : "live";
      setMode((prev) => {
        if (prev === "live" && next === "demo") {
          sessionStorage.removeItem(LIVE_PARTNER_KEY);
          setError("Live session expired on the server. Click Live and enter PARTSBOOKING again.");
          clearBookingState();
        }
        return next;
      });
    }
  }

  function clearBookingState() {
    setEvent(null);
    setMap(null);
    allSeatsRef.current = [];
    setSession(null);
    setSectionId("");
    setZoneId("");
    setMapStep("zones");
    setSelected([]);
    setSeatStatusById({});
    setCheckout(null);
    setResult(null);
    setOpeningMap(false);
    setView(VIEWS.events);
  }

  async function switchToDemo() {
    setModeBusy(true);
    setError("");
    setShowLiveForm(false);
    setPartnerCode("");
    sessionStorage.removeItem(LIVE_PARTNER_KEY);
    setQuery("");
    setCategory("");
    try {
      const res = await api.setMode({ mode: "demo" });
      setMode(res.mode || "demo");
      clearBookingState();
      await loadEvents("", "");
    } catch (e) {
      setError(e.message);
    } finally {
      setModeBusy(false);
    }
  }

  async function switchToLive(e) {
    e?.preventDefault?.();
    const code = partnerCode.trim();
    if (!code) {
      setError("Enter your partner code to go Live (e.g. PARTSBOOKING).");
      return;
    }
    setModeBusy(true);
    setError("");
    setQuery("");
    setCategory("");
    try {
      // Guide: login with partner code → list invited events via x-partner-code.
      const res = await api.setMode({ mode: "live", partner_code: code });
      setMode(res.mode || "live");
      sessionStorage.setItem(LIVE_PARTNER_KEY, code.toUpperCase());
      setShowLiveForm(false);
      clearBookingState();
      await loadEvents("", "");
    } catch (err) {
      sessionStorage.removeItem(LIVE_PARTNER_KEY);
      setError(err.message || "Could not switch to Live.");
      setMode("demo");
      await loadEvents("", "");
    } finally {
      setModeBusy(false);
    }
  }

  async function loadEvents(nextQuery = query, nextCategory = category) {
    setLoading(true);
    setError("");
    try {
      const res = await api.listEvents({
        q: nextQuery || undefined,
        category: nextCategory || undefined,
      });
      syncModeFromResponse(res);
      const list = res.data?.events ?? res.events ?? [];
      setEvents(Array.isArray(list) ? list : []);
    } catch (e) {
      setError(e.message);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }

  async function openDetail(ev) {
    // Guide: only GET /events for the list — no GET /events/:id or /map.
    // Stadium map arrives later from POST /booking-sessions.
    setError("");
    setSelected([]);
    setResult(null);
    setSession(null);
    setMap(null);
    allSeatsRef.current = [];
    setMapStep("zones");
    setSectionId("");
    setZoneId("");
    setEvent(ev);
    setView(VIEWS.detail);
  }

  async function openMap() {
    if (!event || openingMap) return;
    const code = eventAccessCode.trim();
    // Don't send placeholder text as the invite code
    if (code && /access_code from invite|demo-access \(or blank\)/i.test(code)) {
      setError("Enter the real event invite code (or leave blank in Demo).");
      return;
    }
    setOpeningMap(true);
    setError("");
    try {
      let sess = session;
      if (!sess?.session_id) {
        // Guide step 2: POST /booking-sessions { event_id, access_code } → map in reply
        const sessionRes = await api.createSession({
          event_id: event.id,
          access_code: code || undefined,
        });
        sess = sessionRes?.data || sessionRes;
        if (!sess?.session_id) {
          throw new Error("Booking session created but session_id missing.");
        }
        setSession({
          session_id: sess.session_id,
          event_id: sess.event_id || event.id,
          status: sess.status,
          expires_at: sess.expires_at,
        });
        if (sess.event) {
          setEvent((prev) => ({ ...(prev || {}), ...sess.event }));
        }
        const mapData = sess.map || {};
        const priced = eventPriceZones(sess.event || event, mapData.zones || []);
        const byCode = Object.fromEntries(priced.map((z) => [z.code, z.price]));
        const byName = Object.fromEntries(priced.map((z) => [z.name, z.price]));
        const enrichedZones = (mapData.zones || []).map((z) => ({
          ...z,
          price: byCode[z.code] ?? byName[z.name] ?? z.price ?? z.sales_price_num ?? null,
          sales_price_num: z.sales_price_num ?? byCode[z.code] ?? byName[z.name] ?? null,
        }));
        // Heavy seats stay out of React state (guide may return many); section seats via GET ?section_id=
        allSeatsRef.current = mapData.seats || [];
        setMap({
          event_id: mapData.event_id || sess.event_id || event.id,
          stadium: mapData.stadium,
          zones: enrichedZones,
          sections: mapData.sections || [],
          seats: [],
        });
      }
      setMapStep("zones");
      setZoneId("");
      setSectionId("");
      setSelected([]);
      setSeatStatusById({});
      setCheckout(null);
      setView(VIEWS.map);
    } catch (e) {
      setError(e.message || "Could not start booking. Please try again.");
    } finally {
      setOpeningMap(false);
    }
  }

  function pickZone(zone) {
    setZoneId(String(zone.id));
    setSectionId("");
    setSeatStatusById({});
    setMap((prev) => (prev ? { ...prev, seats: [] } : prev));
    setMapStep("sections");
  }

  async function loadSectionSeats(sessionId, secId, heldSeats = selected) {
    // Docs: GET /booking-sessions/:id?section_id=
    const seatsRes = await api.getSeats(sessionId, secId);
    syncModeFromResponse(seatsRes);
    const data = seatsRes.data || seatsRes;
    const liveSeats =
      data.availability?.seats ||
      data.seats ||
      data.availability?.section?.seats ||
      [];
    const next = {};
    for (const s of liveSeats) {
      const id = String(s.seat_id || s.id);
      if (!id || id === "undefined") continue;
      next[id] = {
        status: s.status || "available",
        price: s.price,
        seat_code: s.seat_code,
      };
    }
    for (const sel of heldSeats) {
      if (String(sel.section_id) === String(secId) && sel.hold_id) {
        next[String(sel.seat_id)] = {
          ...(next[String(sel.seat_id)] || {}),
          status: "held",
          price: sel.price ?? next[String(sel.seat_id)]?.price,
          seat_code: sel.seat_code || next[String(sel.seat_id)]?.seat_code,
        };
      }
    }
    setSeatStatusById(next);
    return liveSeats;
  }

  function resolveHoldSeatId(seat) {
    const raw = String(seat.seat_id || seat.id || "");
    if (raw && seatStatusById[raw]) return raw;
    const code = seat.seat_code;
    if (code) {
      const match = Object.entries(seatStatusById).find(
        ([, v]) => v.seat_code && String(v.seat_code) === String(code)
      );
      if (match) return match[0];
    }
    return raw;
  }

  async function pickSection(section) {
    if (!session?.session_id) {
      setError("Create a booking session first.");
      return;
    }
    const secId = String(section.id);
    setSectionId(secId);
    setZoneId(String(section.zone_id || zoneId));
    setMapStep("seats");
    setSeatsLoading(true);
    setError("");
    try {
      const liveSeats = await loadSectionSeats(session.session_id, secId);
      if (!liveSeats.length) {
        setError("No seats returned for this section.");
        setMap((prev) => (prev ? { ...prev, seats: [] } : prev));
        return;
      }

      const geo = allSeatsRef.current.filter((s) => String(s.section_id) === secId);
      const liveById = new Map(liveSeats.map((s) => [String(s.seat_id || s.id), s]));
      const liveByCode = new Map(
        liveSeats.filter((s) => s.seat_code).map((s) => [String(s.seat_code), s])
      );

      let painted;
      if (geo.length) {
        // Prefer stadium geometry from session map when present.
        const overlap = geo.filter((g) => liveById.has(String(g.seat_id || g.id))).length;
        painted = geo.map((g) => {
          const geoId = String(g.seat_id || g.id);
          let live = liveById.get(geoId);
          if (!live && g.seat_code) live = liveByCode.get(String(g.seat_code));
          if (!live && overlap === 0 && liveSeats.length === geo.length) {
            return { ...g, id: geoId, seat_id: geoId };
          }
          if (!live) {
            return { ...g, id: geoId, seat_id: geoId, status: "sold" };
          }
          const liveId = String(live.seat_id || live.id);
          return {
            ...g,
            id: liveId,
            seat_id: liveId,
            seat_code: live.seat_code || g.seat_code,
            status: live.status || g.status || "available",
            price: live.price ?? g.price,
          };
        });
      } else {
        // Session map seats are often omitted for size — lay out live availability seats.
        painted = layoutSectionSeats(section, liveSeats);
      }

      setMap((prev) => (prev ? { ...prev, seats: painted } : prev));
    } catch (e) {
      setError(e.message);
      setMap((prev) => (prev ? { ...prev, seats: [] } : prev));
    } finally {
      setSeatsLoading(false);
    }
  }

  async function toggleSeat(seat) {
    if (!session?.session_id || holdBusy) return;
    const seatId = resolveHoldSeatId(seat);
    if (!seatId || seatId === "undefined") {
      setError("Seat id missing — reload the section and try again.");
      return;
    }
    if (Object.keys(seatStatusById).length && !seatStatusById[seatId]) {
      setError("That seat is not in live availability. Pick a green free seat.");
      return;
    }
    const existing = selected.find((s) => s.seat_id === seatId);

    if (existing) {
      setHoldBusy(true);
      setError("");
      try {
        if (existing.hold_id) {
          const rel = await api.releaseHold(session.session_id, existing.hold_id);
          syncModeFromResponse(rel);
        }
        const nextHeld = selected.filter((s) => s.seat_id !== seatId);
        setSelected(nextHeld);
        setSeatStatusById((prev) => ({
          ...prev,
          [seatId]: { ...(prev[seatId] || {}), status: "available" },
        }));
      } catch (e) {
        setError(e.message);
      } finally {
        setHoldBusy(false);
      }
      return;
    }

    if (selected.length >= ticketCount) {
      setError(`Pick exactly ${ticketCount} seats (raise Tickets if you need more).`);
      return;
    }

    setHoldBusy(true);
    setError("");
    try {
      // Guide step 4: POST /holds { seat_id } only
      const holdRes = await api.createHold(session.session_id, seatId);
      syncModeFromResponse(holdRes);
      const hold = holdRes.data?.hold || holdRes.hold;
      if (!hold?.id) throw new Error("Hold response missing hold.id");
      const row = {
        seat_id: seatId,
        hold_id: String(hold.id),
        seat_code: hold.seat_code || seat.seat_code,
        price: hold.price ?? seat.price,
        section_id: String(hold.section_id || seat.section_id || sectionId),
        zone_id: String(hold.zone_id || seat.zone_id || zoneId),
        remaining_seconds: hold.remaining_seconds,
        expires_at: hold.expires_at,
      };
      setSelected((prev) => [...prev, row]);
      setSeatStatusById((prev) => ({
        ...prev,
        [seatId]: {
          status: "held",
          price: row.price,
          seat_code: row.seat_code,
        },
      }));
    } catch (e) {
      setError(e.message);
    } finally {
      setHoldBusy(false);
    }
  }

  async function setTicketCountSafe(next) {
    const n = Math.max(1, Math.min(8, next));
    if (n >= selected.length) {
      setTicketCount(n);
      setError("");
      return;
    }
    // Release overflow holds when lowering ticket count
    const keep = selected.slice(0, n);
    const drop = selected.slice(n);
    setHoldBusy(true);
    try {
      for (const s of drop) {
        if (s.hold_id && session?.session_id) {
          await api.releaseHold(session.session_id, s.hold_id);
        }
      }
      setSelected(keep);
      setTicketCount(n);
      setSeatStatusById((prev) => {
        const copy = { ...prev };
        for (const s of drop) {
          copy[s.seat_id] = { ...(copy[s.seat_id] || {}), status: "available" };
        }
        return copy;
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setHoldBusy(false);
    }
  }

  async function goCheckout() {
    if (!session?.session_id) return;
    if (!selected.length) {
      setError("Select at least one seat first.");
      return;
    }
    if (selected.length !== ticketCount) {
      setError(`Select exactly ${ticketCount} seats — you have ${selected.length}.`);
      return;
    }
    if (selected.some((s) => !s.hold_id)) {
      setError("Seat reservation failed — please pick your seats again.");
      return;
    }
    setSeatsLoading(true);
    setError("");
    try {
      const checkoutRes = await api.checkout(session.session_id);
      const data = checkoutRes.data || checkoutRes;
      setCheckout(data);
      setView(VIEWS.checkout);
    } catch (e) {
      setError(e.message);
    } finally {
      setSeatsLoading(false);
    }
  }

  async function openTickets() {
    setView(VIEWS.tickets);
    setError("");
    try {
      const res = await api.listTickets();
      const fromApi = res.data?.orders || [];
      if (fromApi.length) {
        const merged = [...fromApi, ...loadLocalOrders()].filter(
          (o, i, arr) => arr.findIndex((x) => String(x.id) === String(o.id)) === i
        );
        setOrders(merged);
        localStorage.setItem(TICKETS_KEY, JSON.stringify(merged.slice(0, 100)));
      } else {
        setOrders(loadLocalOrders());
      }
    } catch {
      setOrders(loadLocalOrders());
    }
  }

  async function confirmPayment() {
    if (!session?.session_id || !selected.length) return;
    setPaying(true);
    setError("");
    try {
      // Guide step 6 via BFF: partner pay → POST /purchases (docs body + customer)
      const res = await api.pay({
        session_id: session.session_id,
        hold_ids: selected.map((s) => s.hold_id).filter(Boolean),
        payment_method: "ORANGE_MONEY",
        payment_status: "yes",
        event_title: event?.title || null,
        customer: {
          name: "Demo Booking Fan",
          phone: "+224620000000",
          email: "fan@example.com",
        },
      });
      const tickets =
        res.purchase?.tickets ||
        res.purchase?.data?.tickets ||
        res.tickets ||
        (res.checkout?.items || []).map((item, idx) => ({
          id: item.hold_id || item.seat_id || String(idx),
          ticket_number: `DB-${String(idx + 1).padStart(3, "0")}`,
          seat_code: item.seat_code,
          seat_id: item.seat_id,
          status: "CONFIRMED",
        }));
      if (!tickets.length) {
        for (const [idx, s] of selected.entries()) {
          tickets.push({
            id: s.hold_id || s.seat_id || String(idx),
            ticket_number: `DB-${String(idx + 1).padStart(3, "0")}`,
            seat_code: s.seat_code,
            seat_id: s.seat_id,
            status: "CONFIRMED",
          });
        }
      }
      const orderId = res.purchase?.order_id || res.payment?.reference || `ord-${Date.now()}`;
      const resultPayload = {
        ...res,
        purchase: {
          ...(res.purchase || {}),
          order_id: orderId,
          tickets,
        },
      };
      setResult(resultPayload);
      const localOrder = {
        id: orderId,
        created_at: new Date().toISOString(),
        demo: Boolean(res.demo),
        event_id: event?.id || res.checkout?.event_id || null,
        event_title: event?.title || null,
        amount: res.payment?.amount ?? res.checkout?.amount ?? null,
        currency: res.payment?.currency || "GNF",
        payment_reference: res.payment?.reference || null,
        warning: res.warning || null,
        tickets,
      };
      setOrders(saveLocalOrder(localOrder));
      setView(VIEWS.success);
    } catch (e) {
      setError(e.message);
    } finally {
      setPaying(false);
    }
  }

  function resetHome() {
    setView(VIEWS.events);
    setEvent(null);
    setMap(null);
    allSeatsRef.current = [];
    setSession(null);
    setSelected([]);
    setSeatStatusById({});
    setCheckout(null);
    setResult(null);
    setMapStep("zones");
    setZoneId("");
    setSectionId("");
    setOpeningMap(false);
    loadEvents();
  }

  const zones = map?.zones || [];
  const sections = map?.sections || [];
  const zoneSections = useMemo(
    () => sections.filter((s) => String(s.zone_id) === String(zoneId)),
    [sections, zoneId]
  );
  const selectedIds = useMemo(() => new Set(selected.map((s) => String(s.seat_id))), [selected]);
  const total = selected.reduce((sum, s) => sum + (s.price || 0), 0);
  const activeZone = zones.find((z) => String(z.id) === String(zoneId));
  const activeSection = sections.find((s) => String(s.id) === String(sectionId));
  const flowIndex =
    view === VIEWS.events
      ? 0
      : view === VIEWS.detail
        ? 1
        : view === VIEWS.map
          ? 2
          : view === VIEWS.checkout
            ? 3
            : view === VIEWS.success
              ? 4
              : -1;

  return (
    <div className="pb">
      <header className="pb-header">
        <button type="button" className="pb-logo" onClick={resetHome}>
          <span className="pb-mark">DB</span>
          Demo Booking
        </button>
        <div className="pb-header-tools">
          {view !== VIEWS.tickets && (
            <nav className="pb-crumb" aria-label="Progress">
              {FLOW.map((label, i) => (
                <span key={label} className={i <= flowIndex ? "on" : ""}>
                  {label}
                </span>
              ))}
            </nav>
          )}
          <button type="button" className="ghost-btn tickets-nav" onClick={openTickets}>
            My tickets{orders.length ? ` (${orders.reduce((n, o) => n + (o.tickets?.length || 0), 0)})` : ""}
          </button>
          <div className="mode-switch" role="group" aria-label="Booking mode">
            <button
              type="button"
              className={mode === "demo" ? "on" : ""}
              disabled={modeBusy}
              onClick={() => {
                if (mode !== "demo") switchToDemo();
                else setShowLiveForm(false);
              }}
            >
              Demo
            </button>
            <button
              type="button"
              className={mode === "live" ? "on live" : ""}
              disabled={modeBusy}
              onClick={() => {
                if (mode === "live") return;
                setShowLiveForm(true);
                setError("");
              }}
            >
              Live
            </button>
          </div>
        </div>
      </header>

      {showLiveForm && mode !== "live" && (
        <form className="live-secret-bar" onSubmit={switchToLive}>
          <label htmlFor="partner-code">Partner code</label>
          <input
            id="partner-code"
            type="text"
            autoComplete="off"
            placeholder="e.g. PARTSBOOKING"
            value={partnerCode}
            onChange={(e) => setPartnerCode(e.target.value)}
            disabled={modeBusy}
          />
          <button type="submit" className="primary" disabled={modeBusy || !partnerCode.trim()}>
            {modeBusy ? "Connecting…" : "Go Live"}
          </button>
          <button
            type="button"
            className="ghost-btn"
            disabled={modeBusy}
            onClick={() => {
              setShowLiveForm(false);
              setPartnerCode("");
            }}
          >
            Cancel
          </button>
        </form>
      )}

      {error && (
        <div className="pb-alert" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError("")}>
            Close
          </button>
        </div>
      )}

      <main className="pb-main">
        {view === VIEWS.events && (
          <section className="fade">
            <div className="pb-hero">
              <h1>Demo Booking</h1>
              <p>Find matches and concerts, pick your seats, and pay securely.</p>
            </div>

            <form
              className="pb-search"
              onSubmit={(e) => {
                e.preventDefault();
                loadEvents();
              }}
            >
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search match, artist, venue…"
                aria-label="Search events"
              />
              <select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  loadEvents(query, e.target.value);
                }}
                aria-label="Category"
              >
                <option value="">All categories</option>
                <option value="Sport">Sport</option>
                <option value="Concert">Concert</option>
              </select>
              <button type="submit">Search</button>
            </form>

            {loading && !events.length ? (
              <p className="pb-muted">Loading events…</p>
            ) : events.length === 0 ? (
              <div className="empty">
                <h2>No events available</h2>
                <p>
                  {mode === "live"
                    ? "Live is on, but book.stadepassgn.com returned no invited events for this partner. Switch to Demo for mock events, or check the partner invite."
                    : "Demo should show sample matches — click Demo, then refresh."}
                </p>
              </div>
            ) : (
              <div className="event-grid">
                {events.map((ev, i) => (
                  <article key={ev.id} className="event-card" style={{ animationDelay: `${i * 50}ms` }}>
                    <div className="event-card-top">
                      <span className="chip">{ev.category}</span>
                      <span className="when">{formatShort(ev.starts_at)}</span>
                    </div>
                    <h2>{ev.title}</h2>
                    <p>
                      {ev.venue?.name}
                      {ev.venue?.city ? ` · ${ev.venue.city}` : ""}
                    </p>
                    <div className="event-card-foot">
                      <strong>from {formatGnf(eventMinPrice(ev))}</strong>
                      <button type="button" onClick={() => openDetail(ev)}>
                        View
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {view === VIEWS.detail && event && (
          <section className="fade detail">
            <button type="button" className="back" onClick={() => setView(VIEWS.events)}>
              ← All events
            </button>
            <div className="detail-grid">
              <div>
                <span className="chip">{event.category}</span>
                <h1>{event.title}</h1>
                <p className="lead">{formatDate(event.starts_at)}</p>
                <p className="pb-muted">
                  {event.venue?.name}, {event.venue?.city}
                  {event.venue?.country ? `, ${event.venue.country}` : ""}
                </p>
                <p className="desc">{event.description || "Official tickets via Demo Booking."}</p>

                <h3>Price zones</h3>
                <ul className="price-list">
                  {eventPriceZones(event, zones).length ? (
                    eventPriceZones(event, zones).map((z) => (
                      <li key={z.code || z.name}>
                        <span>{z.name}</span>
                        <strong>{formatGnf(z.price)}</strong>
                      </li>
                    ))
                  ) : (
                    <li>
                      <span>From</span>
                      <strong>{formatGnf(eventMinPrice(event))}</strong>
                    </li>
                  )}
                </ul>
              </div>

              <aside className="detail-side">
                <div className="side-box">
                  <p className="side-label">Tickets</p>
                  <div className="qty">
                    <button
                      type="button"
                      aria-label="Fewer tickets"
                      onClick={() => {
                        setTicketCount((n) => Math.max(1, n - 1));
                        setSelected((prev) => prev.slice(0, Math.max(1, ticketCount - 1)));
                      }}
                    >
                      −
                    </button>
                    <strong>{ticketCount}</strong>
                    <button
                      type="button"
                      aria-label="More tickets"
                      onClick={() => setTicketCount((n) => Math.min(8, n + 1))}
                    >
                      +
                    </button>
                  </div>
                  <p className="pb-muted small">Choose your stand and seats on the stadium map.</p>
                  <label className="access-code-field" htmlFor="event-access-code">
                    Event invite code
                    <input
                      id="event-access-code"
                      type="text"
                      autoComplete="off"
                      placeholder="P84AXAQ4LQDL (or leave blank)"
                      value={eventAccessCode}
                      onChange={(e) => setEventAccessCode(e.target.value)}
                      disabled={openingMap || loading}
                    />
                  </label>
                  <button type="button" className="primary wide" disabled={openingMap || loading} onClick={openMap}>
                    {openingMap ? "Opening session…" : "Select seats"}
                  </button>
                  {openingMap && (
                    <p className="pb-muted small">Talking to Core — first open can take up to a minute.</p>
                  )}
                </div>
                <div className="mini-map preview">
                  <p className="mini-title">Stadium</p>
                  {map?.zones?.length ? (
                    <StadiumVenue map={map} mode="zones" interactive={false} compact />
                  ) : (
                    <p className="pb-muted small">
                      Map loads when you open a booking session (POST /booking-sessions).
                    </p>
                  )}
                </div>
              </aside>
            </div>
          </section>
        )}

        {view === VIEWS.map && event && (
          <section className="fade map-view">
            <div className="map-top">
              <div>
                <button type="button" className="back" onClick={() => setView(VIEWS.detail)}>
                  ← Event details
                </button>
                <h1>Select your seats</h1>
                <p className="pb-muted">
                  {event.title} · {selected.length}/{ticketCount} selected
                  {activeSection ? ` · ${activeSection.code || activeSection.name}` : ""}
                </p>
              </div>
              <div className="map-actions">
                <div className="qty compact">
                  <span>Tickets</span>
                  <button type="button" disabled={holdBusy} onClick={() => setTicketCountSafe(ticketCount - 1)}>
                    −
                  </button>
                  <strong>{ticketCount}</strong>
                  <button type="button" disabled={holdBusy} onClick={() => setTicketCountSafe(ticketCount + 1)}>
                    +
                  </button>
                </div>
                <button type="button" className="primary" disabled={selected.length !== ticketCount || seatsLoading || holdBusy} onClick={goCheckout}>
                  {selected.length}/{ticketCount} · Continue
                </button>
              </div>
            </div>

            <div className="map-steps">
              <button
                type="button"
                className={mapStep === "zones" ? "on" : ""}
                onClick={() => {
                  setMapStep("zones");
                  setSectionId("");
                }}
              >
                1. Stand
              </button>
              <button
                type="button"
                className={mapStep === "sections" ? "on" : ""}
                disabled={!zoneId}
                onClick={() => zoneId && setMapStep("sections")}
              >
                2. Section
              </button>
              <button
                type="button"
                className={mapStep === "seats" ? "on" : ""}
                disabled={!sectionId}
                onClick={() => sectionId && setMapStep("seats")}
              >
                3. Seats
              </button>
            </div>

            <div className={`map-layout live ${mapStep === "seats" ? "seats-mode" : ""}`}>
              <div className="map-col wide">
                <StadiumVenue
                  map={map}
                  mode={mapStep}
                  activeZoneId={zoneId}
                  activeSectionId={sectionId}
                  selectedIds={selectedIds}
                  seatStatusById={seatStatusById}
                  onSelectZone={pickZone}
                  onSelectSection={pickSection}
                  onToggleSeat={toggleSeat}
                  busy={seatsLoading || holdBusy}
                />
              </div>

              <aside className="cart-col">
                {mapStep === "zones" && (
                  <>
                    <h3>Tribunes</h3>
                    <p className="pb-muted small">Tap a stand on the map, or choose one below.</p>
                    <ul className="zone-pick-list">
                      {zones.map((z) => (
                        <li key={z.id}>
                          <button type="button" onClick={() => pickZone(z)}>
                            <i style={{ background: z.display_color || "#16A34A" }} />
                            <span>
                              <strong>{z.name}</strong>
                              <em>
                                {formatGnf(zonePrice(z))} · {(z.sales_available_seats || 0).toLocaleString()} seats
                              </em>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {mapStep === "sections" && (
                  <>
                    <button type="button" className="back" onClick={() => setMapStep("zones")}>
                      ← All tribunes
                    </button>
                    <h3>{activeZone?.name || "Sections"}</h3>
                    <p className="pb-muted small">{zoneSections.length} sections — pick one to see seats</p>
                    <SectionList
                      sections={zoneSections}
                      activeSectionId={sectionId}
                      onSelectSection={pickSection}
                      disabled={seatsLoading}
                    />
                    {seatsLoading && <p className="pb-muted small">Opening section seats…</p>}
                  </>
                )}

                {mapStep === "seats" && (
                  <>
                    <button type="button" className="back" onClick={() => setMapStep("sections")}>
                      ← Sections
                    </button>
                    <h3>{activeSection?.code || activeSection?.name || "Seats"}</h3>
                    <p className="hold-progress">
                      Select <strong>{ticketCount}</strong> seats ·{" "}
                      <strong>
                        {selected.length}/{ticketCount}
                      </strong>
                      {holdBusy ? " · reserving…" : ""}
                    </p>
                    <div className="legend-row">
                      <span>
                        <i className="d avail" /> Free
                      </span>
                      <span>
                        <i className="d pick" /> Yours
                      </span>
                      <span>
                        <i className="d held" /> Taken
                      </span>
                      <span>
                        <i className="d sold" /> Sold
                      </span>
                    </div>
                    <p className="pb-muted small">
                      Tap free seats one by one. Change ticket count above if you need more.
                    </p>
                    {seatsLoading ? (
                      <p className="pb-muted">Loading seats…</p>
                    ) : !selected.length ? (
                      <p className="pb-muted">No seats selected yet — tap seats on the map.</p>
                    ) : (
                      <ul className="cart-list">
                        {selected.map((s) => (
                          <li key={s.seat_id}>
                            <span>
                              {s.seat_code}
                              {s.remaining_seconds != null ? ` · ${s.remaining_seconds}s` : ""}
                            </span>
                            <span>{formatGnf(s.price)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="cart-total">
                      <span>
                        {selected.length}/{ticketCount} selected
                      </span>
                      <strong>{formatGnf(total)}</strong>
                    </div>
                    <button
                      type="button"
                      className="primary wide"
                      disabled={seatsLoading || holdBusy || selected.length !== ticketCount}
                      onClick={goCheckout}
                    >
                      {selected.length !== ticketCount
                        ? `Select ${ticketCount - selected.length} more`
                        : "Continue to payment"}
                    </button>
                  </>
                )}
              </aside>
            </div>
          </section>
        )}

        {view === VIEWS.checkout && (
          <section className="fade checkout">
            <button type="button" className="back" onClick={() => setView(VIEWS.map)}>
              ← Back to map
            </button>
            <h1>Confirm & pay</h1>
            <p className="pb-muted">Review your seats, then pay to receive your tickets.</p>

            <div className="checkout-grid">
              <div className="side-box">
                <h3>{event?.title}</h3>
                <p className="pb-muted small">{formatDate(event?.starts_at)}</p>
                <ul className="cart-list">
                  {(checkout?.items || selected).map((s) => (
                    <li key={s.hold_id || s.seat_id}>
                      <span>Seat {s.seat_code}</span>
                      <span>{formatGnf(s.price)}</span>
                    </li>
                  ))}
                </ul>
                <div className="cart-total">
                  <span>Total</span>
                  <strong>{formatGnf(checkout?.amount ?? total)}</strong>
                </div>
              </div>

              <div className="side-box pay-box">
                <h3>Payment</h3>
                <label className="pay-method">
                  <input type="radio" name="pay" defaultChecked readOnly />
                  Orange Money
                </label>
                <button type="button" className="primary wide" disabled={paying} onClick={confirmPayment}>
                  {paying ? "Processing…" : `Pay ${formatGnf(checkout?.amount ?? total)}`}
                </button>
              </div>
            </div>
          </section>
        )}

        {view === VIEWS.success && result && (
          <section className="fade success">
            <p className="ok">Payment confirmed</p>
            <h1>Your tickets are ready</h1>
            <p className="pb-muted">
              {result.purchase?.order_id ? `Order ${result.purchase.order_id}` : "Keep this confirmation for entry"}
              {result.payment?.reference ? ` · ${result.payment.reference}` : ""}
            </p>
            {result.warning && <p className="pb-alert" style={{ marginTop: "0.75rem" }}>{result.warning}</p>}
            <ul className="ticket-cards">
              {(result.purchase?.tickets || []).length === 0 ? (
                <li>
                  <strong>No ticket lines returned</strong>
                  <span>Payment went through — check Network → /api/payments/pay response</span>
                </li>
              ) : (
                (result.purchase?.tickets || []).map((t) => (
                  <li key={t.id || t.ticket_number || t.seat_id}>
                    <strong>{t.ticket_number || t.id || "Ticket"}</strong>
                    <span>
                      Seat {t.seat_code || t.seat_id || "—"}
                      {t.status ? ` · ${t.status}` : ""}
                    </span>
                  </li>
                ))
              )}
            </ul>
            <button type="button" className="primary" onClick={openTickets}>
              View all tickets
            </button>
            <button type="button" className="ghost-btn" onClick={resetHome} style={{ marginLeft: "0.5rem" }}>
              Back to events
            </button>
          </section>
        )}

        {view === VIEWS.tickets && (
          <section className="fade tickets-dash">
            <button type="button" className="back" onClick={resetHome}>
              ← All events
            </button>
            <h1>My tickets</h1>
            <p className="pb-muted">Orders booked in this app (Demo & Live).</p>

            {!orders.length ? (
              <div className="empty">
                <h2>No tickets yet</h2>
                <p>Book seats and pay — your tickets will show up here.</p>
                <button type="button" className="primary" onClick={resetHome}>
                  Browse events
                </button>
              </div>
            ) : (
              <div className="orders-list">
                {orders.map((o) => (
                  <article key={o.id} className="order-card">
                    <header>
                      <div>
                        <h2>{o.event_title || `Event ${o.event_id || "—"}`}</h2>
                        <p className="pb-muted small">
                          {o.created_at ? new Date(o.created_at).toLocaleString() : ""}
                          {o.demo ? " · Demo" : " · Live"}
                          {o.payment_reference ? ` · ${o.payment_reference}` : ""}
                        </p>
                      </div>
                      <strong>{formatGnf(o.amount)}</strong>
                    </header>
                    {o.warning && <p className="pb-muted small">{o.warning}</p>}
                    <ul className="ticket-cards">
                      {(o.tickets || []).map((t) => (
                        <li key={t.id || t.ticket_number || t.seat_id}>
                          <strong>{t.ticket_number || t.id || "Ticket"}</strong>
                          <span>
                            Seat {t.seat_code || t.seat_id || "—"}
                            {t.status ? ` · ${t.status}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      <footer className="pb-footer">
        <span>© Demo Booking</span>
        <span>Stadium tickets</span>
      </footer>
    </div>
  );
}

