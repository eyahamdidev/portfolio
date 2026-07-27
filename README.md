# Eya Hamdi OS — portfolio site

A Windows XP–style desktop simulator portfolio, built with React + Vite.

## Run locally

```
npm install
npm run dev
```

Open the printed localhost URL. Without a deployed backend, Admin login
will always fail closed (see "Security model" below) — this is expected;
full local testing of Admin requires `vercel dev` (see next section) or a
deployment.

## Deploying so Admin's edits are visible to every visitor

By default, each visitor's browser has its own separate storage — if you
add a project as Admin, only you see it. To make Admin's additions show up
for everyone who visits your live site, you need a small shared backend.
This project already ships with one, using **Vercel + Upstash Redis**
(both have generous free tiers).

### 1. Create a free Redis database

1. Go to https://upstash.com and sign up (free).
2. Create a new Redis database (any region close to you).
3. On the database's dashboard, find **REST API** section — copy:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

### 2. Deploy to Vercel

1. Push this project to a GitHub repo.
2. Go to https://vercel.com, "Add New Project", import that repo.
   Vercel auto-detects Vite — no config needed.
3. Before deploying, open **Environment Variables** and add:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
   - `ADMIN_PASSWORD` — your real admin password (don't leave this unset —
     see "Security model" below)
   - `ADMIN_TOKEN_SECRET` — any long random string (e.g. run
     `openssl rand -hex 32` and paste the output). This signs Admin
     sessions; keep it secret.
4. Deploy.

That's it. `src/main.jsx` automatically talks to `/api/storage` and
`/api/login` once they're live, falling back to localStorage only when
there's no backend at all (plain local dev).

### Testing Admin locally before deploying

Install the Vercel CLI and run `vercel dev` instead of `npm run dev` —
this runs both the Vite dev server and the `/api` serverless functions
together, so Admin login and writes work exactly like production
(pointed at whatever Upstash DB you configure in a local `.env` file).

**If `vercel dev` errors with "Support for single file deployments has
been removed"**: delete the `.vercel` folder in this project (Windows:
`rmdir /s /q .vercel`, Mac/Linux: `rm -rf .vercel`) and run `vercel dev`
again. This was caused by a Vercel builder bug when a function imports a
sibling file — already fixed in this project (each `api/*.js` file is now
fully self-contained), but a stale `.vercel/builders` cache from before
that fix can still trigger the old error until it's cleared.

### Alternative backends

The storage interface used throughout the app (`get`/`set`/`delete`/`list`
by string key) is intentionally simple, so you can swap Upstash for:
- **Firebase Firestore / Realtime Database**
- **Supabase** (Postgres + instant REST API)
- **Netlify Blobs**, if hosting on Netlify instead of Vercel

You'd just rewrite `api/storage.js` (or add an equivalent Netlify function)
to talk to whichever service you pick — `src/main.jsx` doesn't need to change.

## A note on the "real file upload" feature

Admin can upload actual files (e.g. a real CV PDF) via the My Computer app —
these are read client-side and stored as base64 inside the same key-value
store as everything else (Upstash Redis when deployed, localStorage when
not). That's simple and works well for typical documents (a CV, a small
PDF), but:

- There's a **~4MB per-file cap** enforced in the UI (`MAX_UPLOAD_BYTES` in
  `MyComputerApp`) — Upstash's free tier and the Claude-artifact storage
  API both have limits on value size, and base64 inflates the original
  file by ~33%.
- If you need to host larger files (big datasets, videos, etc.), don't
  raise that cap — instead use "Add Link" and point to the file hosted
  properly elsewhere (Google Drive, GitHub, S3, Vercel Blob, etc.), or
  swap the upload path over to a real object-storage service (Vercel Blob
  is the easiest add-on if you're already on Vercel).


Unlike the previous version of this project, **the admin password is never
shipped to the browser**:

- `api/login.js` checks the password you POST against `ADMIN_PASSWORD`
  (a server-only environment variable) and, only on a match, returns a
  signed, time-limited token (HMAC-SHA256, 12h expiry, generated inline in
  both `api/login.js` and `api/storage.js` — deliberately duplicated rather
  than imported from a shared file; see the note at the top of those files
  if you're curious why),
  verified with a timing-safe comparison).
- `api/storage.js` requires that token on every write (add/edit/delete).
  Reads stay public, since Visitors need to see the same cases/documents.
- The token is kept in `sessionStorage` in the browser (cleared on Log Off
  or when picking Visitor) — never the raw password.

This means someone poking around in browser dev tools can, at most, find
the *token* (which expires in 12h and is useless without the server's
secret to have issued it) — not the password itself, and they cannot call
the write endpoints without a token the server actually issued.

**You still need to actually set real values** for `ADMIN_PASSWORD` and
`ADMIN_TOKEN_SECRET` in your deployment's environment variables — the
fallbacks baked into `api/login.js` / `api/storage.js` (`"eya"` and a derived string) exist
only so the app doesn't crash if you forget, and are not meant to be used
in production.
