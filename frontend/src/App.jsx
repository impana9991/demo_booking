import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import StadiumVenue, { SectionList, formatGnf as formatGnfVenue, zonePrice } from "./StadiumVenue";

function formatGnf(amount) {
  return formatGnfVenue(amount);
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
};

const FLOW = ["Events", "Details", "Seats", "Pay", "Done"];

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
  const [partnerSecret, setPartnerSecret] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const m = await api.getMode();
        setMode(m.mode || (m.demo ? "demo" : "live"));
      } catch {
        setMode("demo");
      }
      loadEvents();
    })();
  }, []);

  function clearBookingState() {
    setEvent(null);
    setMap(null);
    setSession(null);
    setSectionId("");
    setZoneId("");
    setMapStep("zones");
    setSelected([]);
    setSeatStatusById({});
    setCheckout(null);
    setResult(null);
    setView(VIEWS.events);
  }

  async function switchToDemo() {
    setModeBusy(true);
    setError("");
    setShowLiveForm(false);
    setPartnerSecret("");
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
    const secret = partnerSecret.trim();
    if (!secret) {
      setError("Enter your partner secret to go Live.");
      return;
    }
    setModeBusy(true);
    setError("");
    setQuery("");
    setCategory("");
    try {
      const res = await api.setMode({ mode: "live", partner_secret: secret });
      setMode(res.mode || "live");
      setShowLiveForm(false);
      setPartnerSecret("");
      clearBookingState();
      await loadEvents("", "");
    } catch (err) {
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
      if (typeof res.demo === "boolean") {
        setMode(res.demo ? "demo" : "live");
      }
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
    setLoading(true);
    setError("");
    setSelected([]);
    setResult(null);
    setSession(null);
    setMapStep("zones");
    setSectionId("");
    try {
      const [detail, mapRes] = await Promise.all([api.getEvent(ev.id), api.getMap(ev.id)]);
      const detailData = detail.data || detail;
      const mapData = mapRes.data || mapRes;
      const priced = eventPriceZones(detailData);
      const byCode = Object.fromEntries(priced.map((z) => [z.code, z.price]));
      const byName = Object.fromEntries(priced.map((z) => [z.name, z.price]));
      const enrichedZones = (mapData.zones || []).map((z) => ({
        ...z,
        price: byCode[z.code] ?? byName[z.name] ?? z.price ?? z.sales_price_num ?? null,
        sales_price_num: z.sales_price_num ?? byCode[z.code] ?? byName[z.name] ?? null,
      }));
      setEvent(detailData);
      setMap({
        ...mapData,
        zones: enrichedZones,
        sections: mapData.sections || [],
        seats: mapData.seats || [],
      });
      setZoneId("");
      setView(VIEWS.detail);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function openMap() {
    if (!event) return;
    setLoading(true);
    setError("");
    try {
      let sess = session;
      if (!sess?.session_id) {
        const sessionRes = await api.createSession({
          event_id: event.id,
          owner_ref: "demo-booking-user",
        });
        sess = sessionRes.data || sessionRes;
        setSession(sess);
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
      setLoading(false);
    }
  }

  function pickZone(zone) {
    setZoneId(String(zone.id));
    setSectionId("");
    setSeatStatusById({});
    setMapStep("sections");
  }

  async function loadSectionSeats(sessionId, secId, heldSeats = selected) {
    // Docs: GET /booking-sessions/:id?section_id=
    const seatsRes = await api.getSeats(sessionId, secId);
    const liveSeats = seatsRes.data?.availability?.seats || [];
    const next = {};
    for (const s of liveSeats) {
      const id = String(s.seat_id || s.id);
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

  async function pickSection(section) {
    if (!session?.session_id) {
      setError("Create a booking session first.");
      return;
    }
    setSectionId(String(section.id));
    setZoneId(String(section.zone_id || zoneId));
    setMapStep("seats");
    setSeatsLoading(true);
    setError("");
    try {
      await loadSectionSeats(session.session_id, section.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setSeatsLoading(false);
    }
  }

  async function toggleSeat(seat) {
    if (!session?.session_id || holdBusy) return;
    const seatId = String(seat.seat_id);
    const existing = selected.find((s) => s.seat_id === seatId);

    if (existing) {
      setHoldBusy(true);
      setError("");
      try {
        if (existing.hold_id) {
          await api.releaseHold(session.session_id, existing.hold_id);
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
      const holdRes = await api.createHold(session.session_id, {
        seat_id: seatId,
        idempotency_key: `demo-booking:${session.session_id}:${seatId}`,
      });
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

  async function confirmPayment() {
    if (!session?.session_id || !selected.length) return;
    setPaying(true);
    setError("");
    try {
      // Partner payment (simulated yes), then docs: POST /purchases with hold_ids
      const res = await api.pay({
        session_id: session.session_id,
        owner_ref: session.owner_ref || "demo-booking-user",
        hold_ids: selected.map((s) => s.hold_id).filter(Boolean),
        payment_method: "ORANGE_MONEY",
        payment_status: "yes",
      });
      setResult(res);
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
    setSession(null);
    setSelected([]);
    setSeatStatusById({});
    setCheckout(null);
    setResult(null);
    setMapStep("zones");
    setZoneId("");
    setSectionId("");
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
            : 4;

  return (
    <div className="pb">
      <header className="pb-header">
        <button type="button" className="pb-logo" onClick={resetHome}>
          <span className="pb-mark">DB</span>
          Demo Booking
        </button>
        <div className="pb-header-tools">
          <nav className="pb-crumb" aria-label="Progress">
            {FLOW.map((label, i) => (
              <span key={label} className={i <= flowIndex ? "on" : ""}>
                {label}
              </span>
            ))}
          </nav>
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
          <label htmlFor="partner-secret">Partner secret</label>
          <input
            id="partner-secret"
            type="password"
            autoComplete="off"
            placeholder="Event invite secret"
            value={partnerSecret}
            onChange={(e) => setPartnerSecret(e.target.value)}
            disabled={modeBusy}
          />
          <button type="submit" className="primary" disabled={modeBusy || !partnerSecret.trim()}>
            {modeBusy ? "Connecting…" : "Go Live"}
          </button>
          <button
            type="button"
            className="ghost-btn"
            disabled={modeBusy}
            onClick={() => {
              setShowLiveForm(false);
              setPartnerSecret("");
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
                  {eventPriceZones(event, zones).map((z) => (
                    <li key={z.code || z.name}>
                      <span>{z.name}</span>
                      <strong>{formatGnf(z.price)}</strong>
                    </li>
                  ))}
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
                  <button type="button" className="primary wide" disabled={loading} onClick={openMap}>
                    {loading ? "Opening…" : "Select seats"}
                  </button>
                </div>
                <div className="mini-map preview">
                  <p className="mini-title">Stadium</p>
                  <StadiumVenue map={map} mode="zones" interactive={false} compact />
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
            <p className="pb-muted">Keep this confirmation for entry.</p>
            <ul className="ticket-cards">
              {(result.purchase?.tickets || []).map((t) => (
                <li key={t.id}>
                  <strong>{t.ticket_number}</strong>
                  <span>
                    Seat {t.seat_code || t.seat_id} · {t.status}
                  </span>
                </li>
              ))}
            </ul>
            <button type="button" className="primary" onClick={resetHome}>
              Back to events
            </button>
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

