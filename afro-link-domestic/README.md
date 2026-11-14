# Afro-Link Domestic

Asset-light, AI-powered freight marketplace connecting Ethiopian shippers with independent truck operators. Cuts empty return trips, gives drivers instant fuel advances through Telebirr/CBE Birr, and gives shippers live tracking and compliant VAT invoices. Part of DomesticHub (B2B, B2C, e-commerce, advertising, subscriptions) with the Domestic AI Agent.

## Structure

```
packages/
  shared/   Domain core: types, geo, Ethiopian cities, load-matching engine, Ethiopian VAT, fuel-advance rules, payout port, DomainError
  agent/    Domestic AI Agent: six-language intent detection (EN/AM/OM/SO/TI/SW), slot extraction, tool-calling agent core, LLM adapter interface
  api/      Fastify marketplace API (loads, matches, shipments, tracking, advances, invoices, /agent/chat)
apps/
  web/      React + Vite dashboard: shipper (post loads, matches, assign), driver (register, fuel advances), live tracking, AI agent chat (EN/AM)
```

## Quickstart

```bash
npm install
npm test          # run all vitest suites
npm run typecheck
npm run build     # build the web app
npm run dev:api   # start API on http://127.0.0.1:3000
npm run dev:web   # start web dashboard on http://localhost:5173 (proxies /api to the API)
```

The web app reads `VITE_API_BASE` at build time (defaults to `/api`, proxied in dev). For production: `VITE_API_BASE=https://afro-link.domestic.com.et npm run build`.

## API surface

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness probe |
| GET/POST | `/operators` | List / register truck operators |
| GET/POST | `/loads` | List / post freight loads |
| POST | `/loads/:id/cancel` | Cancel an open/assigned load (shipper-owned or admin); frees the operator; blocked once delivered or with an active fuel advance |
| GET | `/loads/:id/matches` | Ranked operator matches (deadhead + backhaul aware) |
| GET/POST | `/shipments` | List / assign a load to an operator |
| POST | `/shipments/:id/events` | Append tracking events (picked_up, in_transit, delivered, ...) |
| GET | `/shipments/:id/tracking` | Live tracking timeline |
| POST | `/shipments/:id/pod` | Capture proof of delivery (receiver name + note) on delivered shipments (operator/admin) |
| GET | `/operators/:id/return-loads` | Backhaul suggestions: open loads near the operator's current location, ranked to cut empty return trips |
| GET | `/operators/:id/earnings` | Driver earnings: delivered shipments, gross ETB, outstanding fuel advances, net (operator/admin only; operators see their own) |
| GET/POST | `/advances` | Fuel advance requests (Telebirr / CBE Birr) |
| POST | `/advances/:id/transition` | approve → disburse → recover state machine |
| GET/POST | `/invoices` | VAT invoices (15% Ethiopian VAT, TIN fields) |
| POST | `/agent/chat` | Domestic AI Agent: conversational posting, matching, advances, tracking, invoicing; accepts `lang` so replies come back in the UI language |
| GET | `/metrics` | Marketplace KPIs: loads/shipments funnel, avg deadhead km, zero-deadhead share, disbursed advances by channel, VAT totals (admin-only when auth is enabled) |
| GET | `/markets/prices` | Lane price benchmark: median ETB per ton-km from delivered loads (lane first, network fallback) → suggested price with ±10% range |
| POST | `/webhooks` | Register an outbound webhook (`{url, events?, secret?}`); receives signed shipment events |
| GET/DELETE | `/webhooks` | List (admin, secrets redacted) / delete (admin) registered webhooks |

## Domain rules baked into `@afro-link/shared`

- **Backhaul engine** (`rankReturnLoads`) flips the matching problem around: given a truck's current location, it ranks open loads that pick up nearby so the return leg earns money instead of running empty. Every assignment records the empty-repositioning distance (`deadheadKm`) from the truck's last drop-off to the pickup city, and `GET /metrics` aggregates it into `avgDeadheadKm` and `zeroDeadheadShare` (< 25 km, the share of trips that avoided a meaningful empty leg) — the platform's core "empty return trips cut" KPIs.
- **Matching engine** ranks operators by empty-repositioning distance from their last drop-off, capacity fit, and backhaul potential near the destination.
- **Lane price benchmarking** (`suggestPrice`) learns ETB-per-ton-km medians from delivered loads — same lane first (≥ 3 deliveries), falling back to the whole network — and suggests a price with a ±10% range. Surfaced via `GET /markets/prices`, the agent ("what price for 20 tons from Jimma to Addis Ababa?" / "ዋጋ"), and a Suggest-price button in the web Shipper form.
- **Driver earnings** (`GET /operators/:id/earnings`) total the value of delivered shipments, subtract outstanding fuel advances (requested/approved/disbursed), and report the net position per operator.
- **Fuel advances** are capped at 20% of the load price, require an assigned load, one active advance per operator, and follow a strict state machine (`requested → approved → disbursed → recovered`, with `rejected`/`defaulted` terminal states). `disburse` and `recover` execute through a **`PayoutAdapter`** (Telebirr / CBE Birr); a failed payout blocks the transition and the advance keeps its status. Simulated adapters ship today (`TB-SIM-*` / `CBE-SIM-*` references) — real gateways implement the same two-method interface.
- **VAT invoices** apply the 15% Ethiopian VAT rate and carry shipper/operator TINs for compliance.
- **Operator KYC** tracks driving-license and insurance expiry dates (`licenseExpiry`/`insuranceExpiry`, ISO dates) on operators. Expired documents block assignment (`409 Operator KYC failed: ...`) and hide the operator from load matches; operators without documents are matched but flagged with a `KYC documents not provided` reason. Expiry fields are on `POST /operators` and in the driver registration form.
- **Proof of delivery** records who received the cargo (receiver name + optional note) on delivered shipments \u2014 `POST /shipments/:id/pod`, a Driver-panel form, and the agent ("confirm delivery received by Abebe Kebede"). Captured offline in the driver PWA, it queues and syncs automatically.
- **Domestic AI Agent** detects intents in English, Amharic (አማርኛ), Oromiffa (Afaan Oromoo), Aff-Somali (Soomaali), Tigrinya (ትግርኛ) and Kiswahili (post load, find trucks, assign, return loads, fuel advance, track, invoice, business report), extracts slots (cities from an 17-city Ethiopian gazetteer, tons, birr amounts, channels, ids), executes through the same `AgentStore` the HTTP API uses, remembers each conversation session (pass `sessionId`; slots and ids from earlier turns fill in follow-ups like “post another 15 tons” or “assign the top match”), answers “show me the business report” / “ሪፖርት” with the live marketplace snapshot, and polishes replies through a pluggable `LlmAdapter`. Pass `lang` on `/agent/chat` (`am`, `om`, `so`, `ti`, `sw`) and the LLM adapter replies in that language; without it the agent answers in English. Set `MISTRAL_API_KEY` to enable the Mistral adapter (`MistralLlmAdapter`, Mistral chat completions API); if the LLM call fails or the key is absent, the agent falls back to its deterministic replies.

## Domain & deployment

Canonical domain: **https://afro-link.domestic.com.et** (Afro-Link Domestic, part of DomesticHub at domestic.com.et).

- The API allowlists browser origins via the `ALLOWED_ORIGINS` env var (comma-separated). Defaults: `https://afro-link.domestic.com.et`, `https://domestic.com.et`, `https://domestic-hub.vercel.app`, and localhost dev ports — see `.env.example`.
- To attach the domain on Vercel (where this repo previews deploy): Vercel dashboard → project **domestic-hub** → Settings → Domains → add `afro-link.domestic.com.et`; then at the DNS host for `domestic.com.et`, create the record Vercel shows (typically `CNAME afro-link → cname.vercel-dns.com`).
- Health check: `GET /health` reports `{ status, service, domain }`.

## Quick start with Docker

```bash
cd afro-link-domestic
docker compose up --build
```

That starts PostgreSQL 16 (with a persistent volume) and the API on `http://127.0.0.1:3000`, connected via `DATABASE_URL` — no local Postgres needed. The API creates its schema on startup. For the web dashboard, run `npm run dev:web` from `afro-link-domestic/` (proxies `/api` to the container). Extra env vars (`MISTRAL_API_KEY`, `AUTH_SECRET`, gateway credentials) can be set in an `.env` file next to `docker-compose.yml`.

## Offline-first driver PWA

`apps/web` is installable and works on patchy Ethiopian mobile networks:

- **Installable app**: web manifest + SVG icon + theme color; the browser offers "Add to home screen".
- **Service worker** (`public/sw.js`): cache-first app shell with versioned cache cleanup; navigations fall back to the cached `index.html` when offline. Registered in production builds only.
- **Outbox sync** (`src/outbox.ts`): POST requests that fail due to network loss (tracking events, advance requests, load posts) are queued in `localStorage` and replayed automatically when connectivity returns. The header shows an offline badge with the queued count (localized EN/አማ).

## Persistence

The API stores all marketplace state through the `MarketplaceRepo` interface:

- **In-memory** (`InMemoryRepo`) — default when `DATABASE_URL` is unset; ideal for local dev and tests.
- **PostgreSQL** (`PgRepo`) — used automatically when `DATABASE_URL` is set, e.g. `postgres://user:pass@host:5432/db`. `PgRepo` creates its schema on startup (`CREATE TABLE IF NOT EXISTS` for operators, loads, shipments, tracking_events, fuel_advances, invoices), so no migration step is needed. `buildServer({ repo })` also accepts an explicit repo instance.
- The Postgres path is exercised in CI against a `postgres:16` service container; locally the `repo-pg` tests skip when `DATABASE_URL` is absent.

## Authentication (DomesticHub SSO)

When `AUTH_SECRET` is set (or `buildServer({ auth: { secret } })` is passed), every write endpoint requires a Bearer token — an HS256 JWT with `sub` (the user id), `role` (`shipper` | `operator` | `admin`) and `exp`. Tokens issued by DomesticHub SSO are verified with the shared `AUTH_SECRET`; reads stay public so tracking links keep working.

Role rules: loads/shipments/invoices → `shipper` or `admin`; operator registration, tracking events and advance requests → `operator` or `admin`; payout transitions → `admin` only. When a shipper posts a load or chats with the agent, the `shipperId` is taken from the token, not the body.

Without `AUTH_SECRET` the API runs in open dev mode (no auth enforced).

Dev token minting:

```bash
AUTH_SECRET=dev-secret npx tsx afro-link-domestic/scripts/mint-token.ts shipper shipper-77 Abebe
```

Paste the token into the web dashboard's SSO token field (stored in `localStorage`) to act as that role.

## Payout gateways (Telebirr / CBE Birr)

Fuel advances settle through the `PayoutAdapter` interface. `payoutAdaptersFromEnv()` picks adapters per channel:

- **Simulated** (default) — instant `TB-SIM-*` / `CBE-SIM-*` references, no network.
- **Telebirr live** — when `TELEBIRR_APP_ID` + `TELEBIRR_APP_KEY` are set. Posts signed (HMAC-SHA256) requests to the Telebirr SuperApp payment gateway (`TELEBIRR_BASE_URL` overrides the default host, `TELEBIRR_SHORT_CODE` optional). Disburse uses the B2C endpoint, recovery the collection endpoint.
- **CBE Birr live** — when `CBE_BIRR_CLIENT_ID` + `CBE_BIRR_CLIENT_SECRET` + `CBE_BIRR_BASE_URL` are set (base URL required because CBE exposes contract-specific endpoints per merchant agreement).

Live gateways enforce a 15s timeout (`*_TIMEOUT_MS` to override), map HTTP/network failures to failed payouts (which blocks the advance transition and preserves its status), and surface the gateway's transaction reference as `TB-*` / `CBE-*`. Verify the exact endpoint paths and payload fields against the merchant contract with Ethio Telecom / CBE before production — they are isolated in `packages/api/src/payouts-live.ts`.

## Webhooks

Register an outbound webhook (`POST /webhooks` with `{url, events?, secret?}`) and Afro-Link Domestic pushes `shipment.assigned`, `shipment.picked_up`, `shipment.delivered` and `load.cancelled` events as JSON with an `X-Afro-Link-Signature: sha256=<hmac>` header (HMAC-SHA256 of the raw body with your secret — verify before trusting the payload). Omit `events` to receive everything; a secret is generated for you when omitted. Delivery failures and slow endpoints (5 s timeout) never block marketplace operations.

## Web app

`apps/web` ships five panels in six languages — English, Amharic (አማርኛ), Oromiffa (Afaan Oromoo), Aff-Somali (Soomaali), Tigrinya (ትግርኛ) and Kiswahili — with a language picker (persisted per browser), voice input in the agent using per-language locales (`am-ET`, `om-ET`, `so-ET`, `ti-ET`, `sw-KE`), an install prompt when the browser offers it, and offline-resilient syncing: POSTs made offline are queued and replayed on reconnect via the `online` event, a 30s retry, and the Background Sync API (`sw.js` listens for the `afrolink-flush` tag and wakes the app to flush its outbox): Shipper, Driver (incl. return-trip suggestions and fuel advances), Tracking, AI Agent, and a Metrics dashboard (`/metrics`, admin SSO token required when auth is enabled) showing the loads funnel, average deadhead km, zero-deadhead share, disbursed advances by channel, and VAT totals.

## Roadmap

- Driver-facing mobile experience (offline-first PWA) on top of the existing web panels.
- Activate live Telebirr / CBE Birr gateway credentials (adapter code is ready; see Payout gateways above).
