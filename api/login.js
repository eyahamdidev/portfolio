// POST /api/login  { password }  ->  { token }  or  401
//
// Fully self-contained on purpose (no relative imports to sibling files):
// Vercel's Node builder has a known bug where functions that `import` a
// local sibling file (e.g. "./_auth.js") can fail file-tracing with a
// misleading "single file deployments has been removed" error, especially
// on Windows. Duplicating this ~20 lines of crypto code into both
// login.js and storage.js sidesteps that entirely.

import crypto from "crypto";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "eya";
const SECRET = process.env.ADMIN_TOKEN_SECRET || `insecure-fallback-${ADMIN_PASSWORD}`;

function sign(payload) {
  return crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
}

function issueToken() {
  const ts = String(Date.now());
  return `${ts}.${sign(ts)}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method not allowed" });
  }

  const { password } = req.body || {};

  if (typeof password !== "string" || password !== ADMIN_PASSWORD) {
    // small delay to blunt naive brute-force / timing probing
    await new Promise((r) => setTimeout(r, 400));
    return res.status(401).json({ error: "incorrect password" });
  }

  return res.status(200).json({ token: issueToken() });
}
