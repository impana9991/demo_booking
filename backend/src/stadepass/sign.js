import crypto from "crypto";

/**
 * StadePass request signature:
 * 1) SHA256(body) hex (empty string for GET/DELETE with no body)
 * 2) canonical = timestamp + "\n" + METHOD + "\n" + path + "\n" + bodyHash
 * 3) HMAC-SHA256(secret, canonical) → hex
 * Path must start with /api/v1/public/... (no query string).
 */
export function signRequest({ secret, timestamp, method, path, body = "" }) {
  const bodyHash = crypto.createHash("sha256").update(body).digest("hex");
  const canonical = `${timestamp}\n${method.toUpperCase()}\n${path}\n${bodyHash}`;
  return crypto.createHmac("sha256", secret).update(canonical).digest("hex");
}

export function apiPathOnly(fullPath) {
  const q = fullPath.indexOf("?");
  return q === -1 ? fullPath : fullPath.slice(0, q);
}
