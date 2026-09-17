import { randomUUID } from "crypto";
import { apiPathOnly, signRequest } from "./sign.js";
import { demoRequest } from "./demo.js";
import { getPartnerCode, isRuntimeDemo } from "./runtime.js";
import { STADEPASS_PUBLIC_BASE_URL } from "./config.js";

function env(name, fallback = "") {
  return process.env[name] ?? fallback;
}

/** Demo unless the UI has logged in Live with a partner code. */
export function isDemoMode() {
  return isRuntimeDemo();
}

export function partnerMeta() {
  return {
    partner_code: getPartnerCode(),
    partner_id: env("STADEPASS_PARTNER_ID") || null,
    has_default_access_code: Boolean(env("STADEPASS_EVENT_ACCESS_CODE")),
    base_url: STADEPASS_PUBLIC_BASE_URL,
  };
}

/**
 * StadePass Public API call (latest guide).
 * Always uses https://book.stadepassgn.com — never local Core.
 * Required: x-partner-code on every /api/v1/public/* request.
 * Optional: HMAC (x-api-key / timestamp / signature) when keys are in .env
 */
export async function stadepassRequest({ method, path, query = {}, body = null }) {
  if (isDemoMode()) {
    return demoRequest({ method, path, query, body });
  }

  const base = STADEPASS_PUBLIC_BASE_URL;
  const partnerCode = getPartnerCode();
  if (!partnerCode) {
    const err = new Error("Missing partner code for Live.");
    err.status = 500;
    throw err;
  }

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const queryString = qs.toString();
  const urlPath = queryString ? `${path}?${queryString}` : path;

  const rawBody = body == null ? "" : JSON.stringify(body);
  const headers = {
    "x-partner-code": partnerCode,
    "x-request-id": randomUUID(),
  };
  if (rawBody) headers["content-type"] = "application/json";

  // Optional HMAC if partner key/secret are configured (Postman env still has these).
  const apiKey = env("STADEPASS_API_KEY");
  const secret = env("STADEPASS_API_SECRET");
  if (apiKey && secret && !apiKey.includes("YOUR_") && !secret.includes("YOUR_")) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    headers["x-api-key"] = apiKey;
    headers["x-api-timestamp"] = timestamp;
    headers["x-api-signature"] = signRequest({
      secret,
      timestamp,
      method,
      path: apiPathOnly(path),
      body: rawBody,
    });
  }

  let res;
  try {
    res = await fetch(`${base}${urlPath}`, {
      method,
      headers,
      body: rawBody || undefined,
    });
  } catch (e) {
    const err = new Error(
      `Cannot reach StadePass at ${base} (${e.message}). Check network or stay in Demo.`
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
