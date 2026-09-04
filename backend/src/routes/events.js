import { Router } from "express";
import { isDemoMode, stadepassRequest } from "../stadepass/client.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const data = await stadepassRequest({
      method: "GET",
      path: "/api/v1/public/events",
      query: {
        page: req.query.page || 1,
        limit: req.query.limit || 12,
        category: req.query.category,
        q: req.query.q,
      },
    });
    res.json({ demo: isDemoMode(), ...data });
  } catch (e) {
    next(e);
  }
});

router.get("/:eventId", async (req, res, next) => {
  try {
    const data = await stadepassRequest({
      method: "GET",
      path: `/api/v1/public/events/${req.params.eventId}`,
    });
    res.json({ demo: isDemoMode(), ...data });
  } catch (e) {
    next(e);
  }
});

router.get("/:eventId/map", async (req, res, next) => {
  try {
    const data = await stadepassRequest({
      method: "GET",
      path: `/api/v1/public/events/${req.params.eventId}/map`,
    });
    res.json({ demo: isDemoMode(), ...data });
  } catch (e) {
    next(e);
  }
});

export default router;
