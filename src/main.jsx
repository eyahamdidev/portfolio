import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

/**
 * `window.storage` only exists inside Claude.ai's artifact sandbox.
 * This shim reproduces the same get/set/delete/list interface for
 * everywhere else, in two layers:
 *
 *  1. Real backend: tries `/api/storage` (a Vercel serverless function
 *     backed by Upstash Redis — see api/storage.js + README.md). This is
 *     what makes Admin's changes visible to every visitor once deployed.
 *     Writes require a signed admin token (see below) — the server
 *     rejects any write that doesn't have one, regardless of what the
 *     client claims.
 *  2. Fallback: if that endpoint doesn't exist (e.g. you're just running
 *     `npm run dev` locally without `vercel dev`), it transparently falls
 *     back to localStorage so the app still works, just per-browser, and
 *     with no server-side write protection (there's no server at all).
 */

// ---- admin session token (obtained from POST /api/login, never the raw password) ----
let adminToken = sessionStorage.getItem("eyaAdminToken") || null;
window.__setAdminToken = (token) => {
  adminToken = token;
  sessionStorage.setItem("eyaAdminToken", token);
};
window.__clearAdminToken = () => {
  adminToken = null;
  sessionStorage.removeItem("eyaAdminToken");
};

if (!window.storage) {
  const lsNs = (key, shared) => `xpos:${shared ? "shared" : "local"}:${key}`;

  const localFallback = {
    async get(key, shared) {
      const raw = localStorage.getItem(lsNs(key, shared));
      if (raw === null) throw new Error("Key not found");
      return { key, value: raw, shared };
    },
    async set(key, value, shared) {
      localStorage.setItem(lsNs(key, shared), value);
      return { key, value, shared };
    },
    async delete(key, shared) {
      localStorage.removeItem(lsNs(key, shared));
      return { key, deleted: true, shared };
    },
    async list(prefix, shared) {
      const p = lsNs(prefix || "", shared);
      const keys = Object.keys(localStorage)
        .filter((k) => k.startsWith(p))
        .map((k) => k.replace(`xpos:${shared ? "shared" : "local"}:`, ""));
      return { keys, prefix, shared };
    },
  };

  async function apiCall(method, params, body) {
    const qs = new URLSearchParams(params).toString();
    const isWrite = method === "POST" || method === "DELETE";
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    if (isWrite && adminToken) headers["x-admin-token"] = adminToken;

    const res = await fetch(`/api/storage${qs ? `?${qs}` : ""}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) throw new Error("no-backend"); // dev server SPA fallback, not a real API
    if (res.status === 404) return null;
    if (res.status === 401) throw new Error("unauthorized"); // real backend exists, but no/expired admin token
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  window.storage = {
    async get(key, shared = false) {
      try {
        const data = await apiCall("GET", { key, shared: String(shared) });
        if (data === null) throw new Error("Key not found");
        return data;
      } catch (e) {
        if (e.message === "no-backend") return localFallback.get(key, shared);
        throw e;
      }
    },
    async set(key, value, shared = false) {
      try {
        return await apiCall("POST", {}, { key, value, shared });
      } catch (e) {
        if (e.message === "no-backend") return localFallback.set(key, value, shared);
        throw e;
      }
    },
    async delete(key, shared = false) {
      try {
        return await apiCall("DELETE", { key, shared: String(shared) });
      } catch (e) {
        if (e.message === "no-backend") return localFallback.delete(key, shared);
        throw e;
      }
    },
    async list(prefix = "", shared = false) {
      try {
        return await apiCall("GET", { list: "1", prefix, shared: String(shared) });
      } catch (e) {
        if (e.message === "no-backend") return localFallback.list(prefix, shared);
        throw e;
      }
    },
  };
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
