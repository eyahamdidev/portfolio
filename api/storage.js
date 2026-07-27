// Vercel serverless function: /api/storage
// Backs the app's shared CRUD data (case files + documents) with Upstash Redis
// so every visitor sees the same data, not just the browser that wrote it.
//
// Reads (GET) are public. Writes (POST/DELETE) require a valid signed admin
// token, obtained via POST /api/login.
//
// NOTE: the token-verification logic below is duplicated from login.js
// rather than imported from a shared file on purpose — Vercel's Node
// builder has a known bug where functions importing a local sibling file
// can fail file-tracing with a misleading "single file deployments has
// been removed" error, especially on Windows. Self-contained functions
// sidestep it entirely.
//
// Setup (see README.md):
//   1. Create a free Redis DB at https://upstash.com
//   2. Copy its REST URL + token into your Vercel project's Environment Variables:
//        UPSTASH_REDIS_REST_URL
//        UPSTASH_REDIS_REST_TOKEN
//   3. Also set (strongly recommended, see README):
//        ADMIN_PASSWORD
//        ADMIN_TOKEN_SECRET
//   4. Deploy. That's it — no other code changes needed.

import { Redis } from "@upstash/redis";
import crypto from "crypto";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "eya";
const SECRET = process.env.ADMIN_TOKEN_SECRET || `insecure-fallback-${ADMIN_PASSWORD}`;
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function sign(payload) {
  return crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
}

function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return false;
  const [ts, sig] = token.split(".");
  if (!ts || !sig) return false;

  const expectedHex = sign(ts);
  let sigBuf, expBuf;
  try {
    sigBuf = Buffer.from(sig, "hex");
    expBuf = Buffer.from(expectedHex, "hex");
  } catch {
    return false;
  }
  if (sigBuf.length !== expBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return false;

  const issuedAt = Number(ts);
  if (!Number.isFinite(issuedAt)) return false;
  return Date.now() - issuedAt < TOKEN_TTL_MS;
}

function fullKey(key, shared) {
  return `${shared ? "shared" : "local"}:${key}`;
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      // Reads are public — Visitors need to see cases/documents too.
      const { key, shared, list, prefix } = req.query;
      const isShared = shared === "true";

      if (list !== undefined) {
        const pattern = `${fullKey(prefix || "", isShared)}*`;
        const keys = await redis.keys(pattern);
        const stripped = keys.map((k) => k.slice(isShared ? 7 : 6));
        return res.status(200).json({ keys: stripped, prefix: prefix || "", shared: isShared });
      }

      const value = await redis.get(fullKey(key, isShared));
      if (value === null || value === undefined) {
        return res.status(404).json({ error: "not found" });
      }
      const raw = typeof value === "string" ? value : JSON.stringify(value);
      return res.status(200).json({ key, value: raw, shared: isShared });
    }

    // Everything below mutates data — require a valid signed admin token.
    const token = req.headers["x-admin-token"];
    if (!verifyToken(token)) {
      return res.status(401).json({ error: "unauthorized" });
    }

    if (req.method === "POST") {
      const { key, value, shared } = req.body || {};
      if (!key) return res.status(400).json({ error: "key required" });
      await redis.set(fullKey(key, !!shared), value);
      return res.status(200).json({ key, value, shared: !!shared });
    }

    if (req.method === "DELETE") {
      const { key, shared } = req.query;
      const isShared = shared === "true";
      await redis.del(fullKey(key, isShared));
      return res.status(200).json({ key, deleted: true, shared: isShared });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
