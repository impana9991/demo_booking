import "dotenv/config";
import express from "express";
import cors from "cors";
import eventsRouter from "./routes/events.js";
import sessionsRouter from "./routes/sessions.js";
import paymentsRouter from "./routes/payments.js";
import ticketsRouter from "./routes/tickets.js";
import { isDemoMode, stadepassRequest } from "./stadepass/client.js";
import { runtimePublic, setRuntimeMode } from "./stadepass/runtime.js";
import { STADEPASS_PUBLIC_BASE_URL } from "./stadepass/config.js";

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.use(cors({ origin: true }));
app.use(express.json());

app.get("/api/health", async (_req, res) => {
  const demo = isDemoMode();
  res.json({
    ok: true,
    ...runtimePublic(),
    core: { reachable: true, mode: demo ? "demo" : "live", base_url: STADEPASS_PUBLIC_BASE_URL },
  });
});

app.get("/api/mode", (_req, res) => {
  res.json({ ok: true, ...runtimePublic() });
});

app.post("/api/mode", async (req, res, next) => {
  try {
    const { mode, partner_code } = req.body || {};
    const result = setRuntimeMode({ mode, partnerCode: partner_code });

    if (result.mode === "live") {
      try {
        // Guide: GET /events with x-partner-code → invited events only.
        await stadepassRequest({
          method: "GET",
          path: "/api/v1/public/events",
          query: { page: 1, limit: 1 },
        });
      } catch (e) {
        setRuntimeMode({ mode: "demo" });
        const core = STADEPASS_PUBLIC_BASE_URL;
        const code = String(partner_code || "").trim().toUpperCase() || "(empty)";
        const baseMsg = e.message || "Could not reach StadePass Core.";
        const hint =
          /invalid partner code/i.test(baseMsg)
            ? ` Partner code "${code}" is not registered on ${core}. Create/invite that partner in StadePass admin, then retry.`
            : /missing public api credentials|authentication failed/i.test(baseMsg)
              ? ` Check STADEPASS_API_KEY / STADEPASS_API_SECRET in backend/.env for ${core}.`
              : "";
        const err = new Error(`${baseMsg}${hint} Staying in Demo.`);
        err.status = e.status || 503;
        throw err;
      }
    }

    res.json({ ok: true, ...runtimePublic() });
  } catch (e) {
    next(e);
  }
});

app.use("/api/events", eventsRouter);
app.use("/api/booking-sessions", sessionsRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/tickets", ticketsRouter);

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  console.error("[api]", status, err.message, err.payload || "");
  res.status(status).json({
    success: false,
    error: err.message || "Server error",
    details: err.payload || undefined,
  });
});

app.listen(PORT, () => {
  console.log(`Demo Booking API on http://localhost:${PORT}`);
  console.log(`Default mode: DEMO (Live = partner code; open seats = event access_code)`);
  console.log(`Core: ${STADEPASS_PUBLIC_BASE_URL}`);
});
