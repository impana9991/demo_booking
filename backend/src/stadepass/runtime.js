/**
 * Runtime Demo / Live switch (in-memory).
 * Default is always demo until the UI opts into live with a partner secret.
 */
const state = {
  mode: "demo", // "demo" | "live"
  partnerSecret: null,
};

export function getRuntimeMode() {
  return state.mode;
}

export function getPartnerSecret() {
  return state.partnerSecret;
}

export function isRuntimeDemo() {
  return state.mode !== "live";
}

export function setRuntimeMode({ mode, partnerSecret }) {
  const next = String(mode || "").toLowerCase() === "live" ? "live" : "demo";

  if (next === "demo") {
    state.mode = "demo";
    state.partnerSecret = null;
    return { mode: state.mode, has_secret: false };
  }

  const secret = String(partnerSecret || "").trim();
  if (!secret) {
    const err = new Error("Partner secret is required to switch to Live.");
    err.status = 400;
    throw err;
  }

  const base = process.env.STADEPASS_BASE_URL;
  const apiKey = process.env.STADEPASS_API_KEY;
  const apiSecret = process.env.STADEPASS_API_SECRET;
  if (!base || !apiKey || !apiSecret || apiKey.includes("your_") || apiSecret.includes("your_")) {
    const err = new Error(
      "Live mode needs STADEPASS_BASE_URL, STADEPASS_API_KEY, and STADEPASS_API_SECRET in backend/.env."
    );
    err.status = 400;
    throw err;
  }

  state.mode = "live";
  state.partnerSecret = secret;
  return { mode: state.mode, has_secret: true };
}

export function runtimePublic() {
  return {
    mode: state.mode,
    demo: state.mode !== "live",
    has_secret: Boolean(state.partnerSecret),
  };
}
