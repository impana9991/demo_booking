import { Router } from "express";
import { randomUUID } from "crypto";
import { isDemoMode, stadepassRequest } from "../stadepass/client.js";
import { getPartnerSecret } from "../stadepass/runtime.js";

const router = Router();

router.post("/", async (req, res, next) => {
  try {
    const { event_id, access_code, owner_ref } = req.body || {};
    if (!event_id) return res.status(400).json({ error: "event_id is required" });

    // Event invite secret (access_code) — NOT the HMAC partner API secret (sps_…).
    // Prefer .env for Live so a mistyped Live-toggle value does not break booking.
    const code =
      access_code ||
      process.env.STADEPASS_EVENT_ACCESS_CODE ||
      getPartnerSecret() ||
      (isDemoMode() ? "demo-access" : undefined);

    if (!code) {
      return res.status(400).json({
        error:
          "Event invite secret missing. Set STADEPASS_EVENT_ACCESS_CODE in backend/.env or enter it when switching to Live.",
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
      res.status(201).json({ demo: isDemoMode(), ...data });
    } catch (e) {
      const msg = String(e.message || "");
      if (e.status === 401 || /ACCESS_DENIED|event secret|access_code/i.test(msg)) {
        const err = new Error(
          "Invalid or missing event invite secret (access_code). Use the secret from the event invite — not the API key (spk_) or HMAC secret (sps_). Check STADEPASS_EVENT_ACCESS_CODE in backend/.env."
        );
        err.status = 401;
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
    res.json({ demo: isDemoMode(), ...data });
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
