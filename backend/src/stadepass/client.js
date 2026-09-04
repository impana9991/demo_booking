import { randomUUID } from "crypto";
import { apiPathOnly, signRequest } from "./sign.js";
import { demoRequest } from "./demo.js";
import { isRuntimeDemo } from "./runtime.js";

function env(name, fallback = "") {
  return process.env[name] ?? fallback;
}

/** Demo unless the UI has switched to Live with a partner secret. */
export function isDemoMode() {
  return isRuntimeDemo();
}

export function partnerMeta() {
  return {
    partner_code: env("STADEPASS_PARTNER_CODE", "PARTSBOOKING") || null,
    partner_id: env("STADEPASS_PARTNER_ID") || null,
    has_default_access_code: Boolean(env("STADEPASS_EVENT_ACCESS_CODE")),
  };
}

/**
 * Signed call to StadePass Public API.
 * @param {{ method: string, path: string, query?: Record<string,string|number|undefined>, body?: object|null }} opts
 */
export async function stadepassRequest({ method, path, query = {}, body = null }) {
  if (isDemoMode()) {
    return demoRequest({ method, path, query, body });
  }

  const base = env("STADEPASS_BASE_URL").replace(/\/$/, "");
  const apiKey = env("STADEPASS_API_KEY");
  const secret = env("STADEPASS_API_SECRET");

  if (!base || !apiKey || !secret) {
    const err = new Error("Missing STADEPASS_BASE_URL / STADEPASS_API_KEY / STADEPASS_API_SECRET");
    err.status = 500;
    throw err;
  }

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const queryString = qs.toString();
  const urlPath = queryString ? `${path}?${queryString}` : path;
  const signPath = apiPathOnly(path);

  const rawBody = body == null ? "" : JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signRequest({
    secret,
    timestamp,
    method,
    path: signPath,
    body: rawBody,
  });

  const headers = {
    "x-api-key": apiKey,
    "x-api-timestamp": timestamp,
    "x-api-signature": signature,
    "x-request-id": randomUUID(),
  };
  if (rawBody) headers["content-type"] = "application/json";

  let res;
  try {
    res = await fetch(`${base}${urlPath}`, {
      method,
      headers,
      body: rawBody || undefined,
    });
  } catch (e) {
    const err = new Error(
      `Cannot reach StadePass at ${base} (${e.message}). Start Core on :8000 or set DEMO_MODE=true.`
    );
    err.status = 503;
    throw err;
  }

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(json?.message || json?.error || `StadePass ${res.status}`);
    err.status = res.status;
    err.payload = json;
    throw err;
  }

  return json;
}
