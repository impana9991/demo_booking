import { Router } from "express";
import { randomUUID } from "crypto";
import { isDemoMode, stadepassRequest } from "../stadepass/client.js";

const router = Router();

/** Core embeds ~20k map seats in session payloads — drop them; UI already has GET /map. */
function slimSessionPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const data = payload.data;
  if (!data?.map || !Array.isArray(data.map.seats) || data.map.seats.length === 0) {
    return payload;
  }
  return {
    ...payload,
    data: {
      ...data,
      map: {
        ...data.map,
        seats_count: data.map.seats.length,
        seats_omitted: true,
        seats: [],
      },
    },
  };
}

router.post("/", async (req, res, next) => {
  try {
    const { event_id, access_code, owner_ref } = req.body || {};
    if (!event_id) return res.status(400).json({ error: "event_id is required" });

    // Guide: access_code = event invite code only (not partner code).
    const fromBody = String(access_code || "").trim();
    const fromEnv = String(process.env.STADEPASS_EVENT_ACCESS_CODE || "").trim();
    const code = fromBody || fromEnv || (isDemoMode() ? "demo-access" : "");

    if (!code) {
      return res.status(400).json({
        error:
          "Event invite code (access_code) required to open this event. Enter it on the event page or set STADEPASS_EVENT_ACCESS_CODE.",
      });
    }

    try {
      const data = await stadepassRequest({
        method: "POST",
        path: "/api/v1/public/booking-sessions",
        body: {
          event_id: String(event_id),
          access_code: String(code),
          owner_ref: owner_ref || `demo-booking-user-${randomUUID().slice(0, 8)}`,
        },
      });
      res.status(201).json({ demo: isDemoMode(), ...slimSessionPayload(data) });
    } catch (e) {
      const msg = String(e.message || "");
      if (e.status === 401 || e.status === 403 || /ACCESS_DENIED|event secret|access_code|Invalid access/i.test(msg)) {
        const err = new Error(
          "Invalid or missing event invite code (access_code). This is the event secret from your invite — not the partner code."
        );
        err.status = e.status || 401;
        err.payload = e.payload;
        throw err;
      }
      throw e;
    }
  } catch (e) {
    next(e);
  }
});

router.get("/:sessionId", async (req, res, next) => {
  try {
    const data = await stadepassRequest({
      method: "GET",
      path: `/api/v1/public/booking-sessions/${req.params.sessionId}`,
      query: { section_id: req.query.section_id },
    });
    // Keep section availability.seats; strip embedded stadium map seats only.
    res.json({ demo: isDemoMode(), ...slimSessionPayload(data) });
  } catch (e) {
    next(e);
  }
});

router.post("/:sessionId/holds", async (req, res, next) => {
  try {
    const { seat_id, idempotency_key } = req.body || {};
    if (!seat_id) return res.status(400).json({ error: "seat_id is required" });

    const data = await stadepassRequest({
      method: "POST",
      path: `/api/v1/public/booking-sessions/${req.params.sessionId}/holds`,
      body: {
        seat_id: String(seat_id),
        idempotency_key: idempotency_key || `hold:${req.params.sessionId}:${seat_id}:${Date.now()}`,
      },
    });
    res.status(201).json({ demo: isDemoMode(), ...data });
  } catch (e) {
    next(e);
  }
});

router.delete("/:sessionId/holds/:holdId", async (req, res, next) => {
  try {
    // Guide: DELETE release-hold — no body.
    const data = await stadepassRequest({
      method: "DELETE",
      path: `/api/v1/public/booking-sessions/${req.params.sessionId}/holds/${req.params.holdId}`,
    });
    res.json({ demo: isDemoMode(), ...data });
  } catch (e) {
    next(e);
  }
});

router.get("/:sessionId/checkout", async (req, res, next) => {
  try {
    const data = await stadepassRequest({
      method: "GET",
      path: `/api/v1/public/booking-sessions/${req.params.sessionId}/checkout`,
    });
    res.json({ demo: isDemoMode(), ...data });
  } catch (e) {
    next(e);
  }
});

export default router;
