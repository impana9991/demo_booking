import { Router } from "express";
import { isDemoMode, stadepassRequest } from "../stadepass/client.js";

const router = Router();

/**
 * Core may embed a huge seats[] in session.map — keep zones/sections for the UI,
 * omit seat geometry (section seats come from GET ?section_id=).
 */
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

/** Guide step 2: POST { event_id, access_code } only — map is in the reply. */
router.post("/", async (req, res, next) => {
  try {
    const { event_id, access_code } = req.body || {};
    if (!event_id) return res.status(400).json({ error: "event_id is required" });

    const fromBody = String(access_code || "").trim();
    const fromEnv = String(process.env.STADEPASS_EVENT_ACCESS_CODE || "").trim();
    const code = fromBody || fromEnv || (isDemoMode() ? "demo-access" : "");

    if (!code) {
      return res.status(400).json({
        error:
          "Event invite code (access_code) required. Enter it on the event page or set STADEPASS_EVENT_ACCESS_CODE.",
      });
    }

    try {
      const data = await stadepassRequest({
        method: "POST",
        path: "/api/v1/public/booking-sessions",
        body: {
          event_id: String(event_id),
          access_code: String(code),
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

/** Guide step 3: GET /booking-sessions/:id?section_id= */
router.get("/:sessionId", async (req, res, next) => {
  try {
    const data = await stadepassRequest({
      method: "GET",
      path: `/api/v1/public/booking-sessions/${req.params.sessionId}`,
      query: { section_id: req.query.section_id },
    });
    res.json({ demo: isDemoMode(), ...slimSessionPayload(data) });
  } catch (e) {
    next(e);
  }
});

/** Guide step 4: POST { seat_id } only */
router.post("/:sessionId/holds", async (req, res, next) => {
  try {
    const { seat_id } = req.body || {};
    if (!seat_id) return res.status(400).json({ error: "seat_id is required" });

    const data = await stadepassRequest({
      method: "POST",
      path: `/api/v1/public/booking-sessions/${req.params.sessionId}/holds`,
      body: { seat_id: String(seat_id) },
    });
    res.status(201).json({ demo: isDemoMode(), ...data });
  } catch (e) {
    next(e);
  }
});

/** Guide: DELETE …/holds/:holdId — no body */
router.delete("/:sessionId/holds/:holdId", async (req, res, next) => {
  try {
    const data = await stadepassRequest({
      method: "DELETE",
      path: `/api/v1/public/booking-sessions/${req.params.sessionId}/holds/${req.params.holdId}`,
    });
    res.json({ demo: isDemoMode(), ...data });
  } catch (e) {
    next(e);
  }
});

/** Guide step 5: GET …/checkout */
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
