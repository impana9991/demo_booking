import { useMemo, useState } from "react";

function formatGnf(amount) {
  if (amount == null || Number.isNaN(Number(amount))) return "—";
  return new Intl.NumberFormat("fr-GN").format(Number(amount)) + " GNF";
}

function zonePrice(z) {
  return z?.sales_price_num ?? z?.price ?? null;
}

function polar(r, deg) {
  const rad = (deg * Math.PI) / 180;
  return [r * Math.cos(rad), r * Math.sin(rad)];
}

function normalizeSweep(start, end) {
  let s = start;
  let e = end;
  while (e < s) e += 360;
  return [s, e];
}

function ringSectorPath(inner, outer, startDeg, endDeg) {
  const [start, end] = normalizeSweep(startDeg, endDeg);
  const sweep = end - start;
  const large = sweep > 180 ? 1 : 0;
  const [x1, y1] = polar(outer, start);
  const [x2, y2] = polar(outer, end);
  const [x3, y3] = polar(inner, end);
  const [x4, y4] = polar(inner, start);
  return [
    `M ${x1} ${y1}`,
    `A ${outer} ${outer} 0 ${large} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${inner} ${inner} 0 ${large} 0 ${x4} ${y4}`,
    "Z",
  ].join(" ");
}

function viewBoxFromRadii(zones, pad = 80) {
  const maxR = Math.max(800, ...zones.map((z) => Number(z.outer_radius) || 0));
  const s = maxR + pad;
  return { minX: -s, minY: -s, width: s * 2, height: s * 2 };
}

function viewBoxForSection(section, seats, pad = 140) {
  if (seats?.length) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const s of seats) {
      minX = Math.min(minX, s.position_x);
      maxX = Math.max(maxX, s.position_x);
      minY = Math.min(minY, s.position_y);
      maxY = Math.max(maxY, s.position_y);
    }
    const w = Math.max(280, maxX - minX);
    const h = Math.max(280, maxY - minY);
    return {
      minX: minX - pad,
      minY: minY - pad,
      width: w + pad * 2,
      height: h + pad * 2,
    };
  }
  if (section) {
    const r = Number(section.outer_radius) || 1200;
    const mid = ((Number(section.start_angle) + Number(section.end_angle)) / 2) * (Math.PI / 180);
    const cx = Math.cos(mid) * r * 0.7;
    const cy = Math.sin(mid) * r * 0.7;
    const span = r * 0.55;
    return { minX: cx - span, minY: cy - span, width: span * 2, height: span * 2 };
  }
  return viewBoxFromRadii([]);
}

/**
 * Visafans-style venue from Core map + live session seat status.
 */
export default function StadiumVenue({
  map,
  mode = "zones",
  activeZoneId,
  activeSectionId,
  selectedIds,
  seatStatusById,
  onSelectZone,
  onSelectSection,
  onToggleSeat,
  interactive = true,
  compact = false,
  busy = false,
}) {
  const zones = map?.zones || [];
  const sections = map?.sections || [];
  const seats = map?.seats || [];
  const [hoverId, setHoverId] = useState(null);

  const zoneSections = useMemo(() => {
    if (!activeZoneId) return [];
    return sections.filter((s) => String(s.zone_id) === String(activeZoneId));
  }, [sections, activeZoneId]);

  const activeZone = zones.find((z) => String(z.id) === String(activeZoneId));
  const activeSection = sections.find((s) => String(s.id) === String(activeSectionId));

  const sectionSeats = useMemo(() => {
    if (!activeSectionId) return [];
    const liveEntries = Object.entries(seatStatusById || {});
    const hasLive = liveEntries.length > 0;
    return seats
      .filter((s) => String(s.section_id) === String(activeSectionId))
      .map((s) => {
        const geoId = String(s.seat_id || s.id);
        let liveId = geoId;
        let live = seatStatusById?.[geoId];
        if (!live && s.seat_code) {
          const match = liveEntries.find(([, v]) => v.seat_code && String(v.seat_code) === String(s.seat_code));
          if (match) {
            liveId = match[0];
            live = match[1];
          }
        }
        // After live availability loads, geometry-only seats are not bookable.
        const status = live?.status || (hasLive ? "sold" : s.status || "available");
        return {
          ...s,
          id: liveId,
          seat_id: liveId,
          status,
          price: live?.price ?? s.price,
          seat_code: live?.seat_code || s.seat_code,
        };
      });
  }, [seats, activeSectionId, seatStatusById]);

  const vb = useMemo(() => {
    if (mode === "seats" && activeSectionId) {
      return viewBoxForSection(activeSection, sectionSeats);
    }
    return viewBoxFromRadii(zones);
  }, [mode, activeSectionId, activeSection, sectionSeats, zones]);

  if (!zones.length) {
    return <div className="venue empty">Map loading…</div>;
  }

  const selected = selectedIds || new Set();
  const height = compact ? 220 : mode === "seats" ? 560 : 420;
  const seatR = mode === "seats" ? Math.max(18, Math.min(36, vb.width / 45)) : 10;

  return (
    <div className={`venue ${interactive ? "interactive" : ""} ${compact ? "compact" : ""} ${busy ? "busy" : ""}`}>
      {busy && <div className="venue-busy">Loading seats…</div>}
      <svg
        viewBox={`${vb.minX} ${vb.minY} ${vb.width} ${vb.height}`}
        className="venue-svg"
        style={{ height }}
        role="img"
        aria-label="Stadium map"
      >
        <defs>
          <radialGradient id="pitchGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#3fa66a" />
            <stop offset="100%" stopColor="#1f6b42" />
          </radialGradient>
        </defs>

        {mode !== "seats" && (
          <>
            <ellipse cx="0" cy="0" rx="420" ry="280" fill="url(#pitchGrad)" stroke="rgba(255,255,255,0.35)" strokeWidth="8" />
            <ellipse cx="0" cy="0" rx="360" ry="230" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="4" />
            <text x="0" y="8" textAnchor="middle" className="pitch-label">
              PITCH
            </text>
          </>
        )}

        {zones.map((z) => {
          const active = String(z.id) === String(activeZoneId);
          const muted = mode !== "zones" && !active;
          const path = ringSectorPath(z.inner_radius, z.outer_radius, z.start_angle, z.end_angle);
          const fill = z.display_color || "#16A34A";
          return (
            <path
              key={`z-${z.id}`}
              d={path}
              fill={fill}
              fillOpacity={muted ? 0.08 : active ? 0.88 : 0.55}
              stroke={active ? "#0c1b2a" : "rgba(255,255,255,0.65)"}
              strokeWidth={active ? 18 : 8}
              className={interactive && mode === "zones" ? "venue-hit" : undefined}
              style={{ cursor: interactive && mode === "zones" ? "pointer" : "default" }}
              onClick={() => interactive && mode === "zones" && onSelectZone?.(z)}
              onMouseEnter={() => setHoverId(`z-${z.id}`)}
              onMouseLeave={() => setHoverId(null)}
            >
              <title>
                {z.name} · from {formatGnf(zonePrice(z))}
              </title>
            </path>
          );
        })}

        {(mode === "sections" || mode === "seats") &&
          zoneSections.map((s) => {
            const active = String(s.id) === String(activeSectionId);
            const path = ringSectorPath(s.inner_radius, s.outer_radius, s.start_angle, s.end_angle);
            const fill = s.display_color || activeZone?.display_color || "#DC2626";
            return (
              <path
                key={`s-${s.id}`}
                d={path}
                fill={fill}
                fillOpacity={mode === "seats" ? (active ? 0.22 : 0.05) : active ? 0.92 : 0.62}
                stroke={active ? "#fff" : "rgba(255,255,255,0.5)"}
                strokeWidth={active ? 14 : 6}
                className={interactive && mode === "sections" ? "venue-hit" : undefined}
                style={{ cursor: interactive && mode === "sections" ? "pointer" : "default" }}
                onClick={() => interactive && mode === "sections" && onSelectSection?.(s)}
                onMouseEnter={() => setHoverId(`s-${s.id}`)}
                onMouseLeave={() => setHoverId(null)}
              >
                <title>
                  {s.name} · {formatGnf(s.price)}
                </title>
              </path>
            );
          })}

        {mode === "seats" &&
          sectionSeats.map((seat) => {
            const id = String(seat.seat_id || seat.id);
            const mine = selected.has(id);
            const sold = seat.status === "sold" || seat.status === "reserved";
            const held = seat.status === "held" && !mine;
            // Legend colors only — ignore Core display_color (often yellow = confusing with "Yours")
            let fill = "#1f8f6a"; // free
            if (mine) fill = "#e8a317"; // yours
            else if (sold) fill = "#4a5560"; // sold
            else if (held) fill = "#9aa8b5"; // held by others
            const canTap = interactive && !busy && (mine || seat.status === "available");
            return (
              <circle
                key={id}
                cx={seat.position_x}
                cy={seat.position_y}
                r={mine ? seatR + 4 : seatR}
                fill={fill}
                stroke={mine ? "#3a2a05" : "rgba(0,0,0,0.35)"}
                strokeWidth={mine ? 4 : 2}
                opacity={sold || held ? 0.7 : 1}
                style={{ cursor: canTap ? "pointer" : "not-allowed" }}
                onClick={() => {
                  if (!canTap) return;
                  onToggleSeat?.({
                    seat_id: id,
                    seat_code: seat.seat_code,
                    price: seat.price,
                    section_id: String(seat.section_id),
                    zone_id: String(seat.zone_id),
                    status: seat.status,
                  });
                }}
              >
                <title>
                  {seat.seat_code} · {formatGnf(seat.price)} · {mine ? "yours" : seat.status}
                </title>
              </circle>
            );
          })}
      </svg>

      <div className="venue-caption">
        {mode === "zones" && (
          <span>
            {interactive
              ? hoverId
                ? zones.find((z) => `z-${z.id}` === hoverId)?.name
                : "Tap a tribune"
              : "Preview — start session first"}
          </span>
        )}
        {mode === "sections" && (
          <span>
            {activeZone?.name} · {zoneSections.length} sections — tap one
          </span>
        )}
        {mode === "seats" && (
          <span>
            {activeSection?.code || activeSection?.name} · {sectionSeats.length} seats — tap to select
          </span>
        )}
      </div>
    </div>
  );
}

export function SectionList({ sections, activeSectionId, onSelectSection, pricesByZone, disabled }) {
  if (!sections?.length) return <p className="pb-muted">No sections in this stand.</p>;
  return (
    <div className="section-grid">
      {sections.map((s) => {
        const active = String(s.id) === String(activeSectionId);
        return (
          <button
            key={s.id}
            type="button"
            className={`section-chip ${active ? "active" : ""}`}
            style={{ "--sec": s.display_color || "#0f6b4c" }}
            disabled={disabled}
            onClick={() => onSelectSection?.(s)}
          >
            <strong>{s.code || s.name}</strong>
            <span>{formatGnf(s.price ?? pricesByZone)}</span>
          </button>
        );
      })}
    </div>
  );
}

export { formatGnf, zonePrice };
