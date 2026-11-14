# Afro-Link Domestic

Asset-light, AI-powered freight marketplace connecting Ethiopian shippers with independent truck operators. Cuts empty return trips, gives drivers instant fuel advances through Telebirr/CBE Birr, and gives shippers live tracking and compliant VAT invoices. Part of DomesticHub (B2B, B2C, e-commerce, advertising, subscriptions) with the Domestic AI Agent.

## Structure

```
packages/
  shared/   Domain core: types, geo, Ethiopian cities, load-matching engine, Ethiopian VAT, fuel-advance rules, payout port, DomainError
  agent/    Domestic AI Agent: EN/AM intent detection, slot extraction, tool-calling agent core, LLM adapter interface
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
| GET | `/loads/:id/matches` | Ranked operator matches (deadhead + backhaul aware) |
| GET/POST | `/shipments` | List / assign a load to an operator |
| POST | `/shipments/:id/events` | Append tracking events (picked_up, in_transit, delivered, ...) |
| GET | `/shipments/:id/tracking` | Live tracking timeline |
| GET/POST | `/advances` | Fuel advance requests (Telebirr / CBE Birr) |
| POST | `/advances/:id/transition` | approve → disburse → recover state machine |
| GET/POST | `/invoices` | VAT invoices (15% Ethiopian VAT, TIN fields) |
| POST | `/agent/chat` | Domestic AI Agent: conversational posting, matching, advances, tracking, invoicing (EN/AM) |

## Domain rules baked into `@afro-link/shared`

- **Matching engine** ranks operators by empty-repositioning distance from their last drop-off, capacity fit, and backhaul potential near the destination.
- **Fuel advances** are capped at 20% of the load price, require an assigned load, one active advance per operator, and follow a strict state machine (`requested → approved → disbursed → recovered`, with `rejected`/`defaulted` terminal states). `disburse` and `recover` execute through a **`PayoutAdapter`** (Telebirr / CBE Birr); a failed payout blocks the transition and the advance keeps its status. Simulated adapters ship today (`TB-SIM-*` / `CBE-SIM-*` references) — real gateways implement the same two-method interface.
- **VAT invoices** apply the 15% Ethiopian VAT rate and carry shipper/operator TINs for compliance.
- **Domestic AI Agent** detects intents in English and Amharic (post load, find trucks, assign, fuel advance, track, invoice), extracts slots (cities from an 17-city Ethiopian gazetteer, tons, birr amounts, channels, ids), executes through the same `AgentStore` the HTTP API uses, and optionally polishes replies through a pluggable `LlmAdapter`.

## Domain & deployment

Canonical domain: **https://afro-link.domestic.com.et** (Afro-Link Domestic, part of DomesticHub at domestic.com.et).

- The API allowlists browser origins via the `ALLOWED_ORIGINS` env var (comma-separated). Defaults: `https://afro-link.domestic.com.et`, `https://domestic.com.et`, `https://domestic-hub.vercel.app`, and localhost dev ports — see `.env.example`.
- To attach the domain on Vercel (where this repo previews deploy): Vercel dashboard → project **domestic-hub** → Settings → Domains → add `afro-link.domestic.com.et`; then at the DNS host for `domestic.com.et`, create the record Vercel shows (typically `CNAME afro-link → cname.vercel-dns.com`).
- Health check: `GET /health` reports `{ status, service, domain }`.

## Roadmap

- `apps/web` — shipper dashboard and driver app (Amharic/English).
- Real Telebirr (SuperApp API) / CBE Birr gateway credentials behind the existing `PayoutAdapter` interface.
- Real LLM adapter (e.g. Mistral) behind the agent's `LlmAdapter` interface, plus voice input.
- Persistent storage (PostgreSQL) replacing the in-memory repo, plus auth via DomesticHub SSO.
