/**
 * Runtime Demo / Live switch (in-memory).
 * Guide: Live uses partner code (x-partner-code) on every Public API call.
 * Event invite code (access_code) is separate — only for POST /booking-sessions.
 * Live Core host is always https://book.stadepassgn.com
 */
import { STADEPASS_PUBLIC_BASE_URL } from "./config.js";

const state = {
  mode: "demo", // "demo" | "live"
  partnerCode: null,
};

export function getRuntimeMode() {
  return state.mode;
}

export function getPartnerCode() {
  return state.partnerCode || process.env.STADEPASS_PARTNER_CODE || "PARTSBOOKING";
}

export function isRuntimeDemo() {
  return state.mode !== "live";
}

export function setRuntimeMode({ mode, partnerCode }) {
  const next = String(mode || "").toLowerCase() === "live" ? "live" : "demo";

  if (next === "demo") {
    state.mode = "demo";
    state.partnerCode = null;
    return { mode: state.mode, partner_code: null, base_url: STADEPASS_PUBLIC_BASE_URL };
  }

  const code = String(partnerCode || "").trim().toUpperCase();
  if (!code) {
    const err = new Error("Partner code is required to go Live (e.g. PARTSBOOKING).");
    err.status = 400;
    throw err;
  }

  state.mode = "live";
  state.partnerCode = code;
  return {
    mode: state.mode,
    partner_code: state.partnerCode,
    base_url: STADEPASS_PUBLIC_BASE_URL,
  };
}

export function runtimePublic() {
  return {
    mode: state.mode,
    demo: state.mode !== "live",
    partner_code: state.mode === "live" ? state.partnerCode : null,
    has_event_access_code: Boolean(process.env.STADEPASS_EVENT_ACCESS_CODE),
    base_url: STADEPASS_PUBLIC_BASE_URL,
  };
}
