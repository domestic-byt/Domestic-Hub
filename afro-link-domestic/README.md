# Afro-Link Domestic

Asset-light, AI-powered freight marketplace connecting Ethiopian shippers with independent truck operators. Cuts empty return trips, gives drivers instant fuel advances through Telebirr/CBE Birr, and gives shippers live tracking and compliant VAT invoices. Part of DomesticHub (B2B, B2C, e-commerce, advertising, subscriptions) with the Domestic AI Agent.

## Structure

```
packages/
  shared/   Domain core: types, geo, Ethiopian cities, load-matching engine, Ethiopian VAT, fuel-advance rules, DomainError
  agent/    Domestic AI Agent: EN/AM intent detection, slot extraction, tool-calling agent core, LLM adapter interface
  api/      Fastify marketplace API (loads, matches, shipments, tracking, advances, invoices, /agent/chat)
```

## Quickstart

```bash
npm install
npm test          # run all vitest suites
npm run typecheck
npm run dev:api   # start API on http://127.0.0.1:3000
```

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
- **Fuel advances** are capped at 20% of the load price, require an assigned load, one active advance per operator, and follow a strict state machine (`requested → approved → disbursed → recovered`, with `rejected`/`defaulted` terminal states).
- **VAT invoices** apply the 15% Ethiopian VAT rate and carry shipper/operator TINs for compliance.
- **Domestic AI Agent** detects intents in English and Amharic (post load, find trucks, assign, fuel advance, track, invoice), extracts slots (cities from an 17-city Ethiopian gazetteer, tons, birr amounts, channels, ids), executes through the same `AgentStore` the HTTP API uses, and optionally polishes replies through a pluggable `LlmAdapter`.

## Domain & deployment

Canonical domain: **https://afro-link.domestic.com.et** (Afro-Link Domestic, part of DomesticHub at domestic.com.et).

- The API allowlists browser origins via the `ALLOWED_ORIGINS` env var (comma-separated). Defaults: `https://afro-link.domestic.com.et`, `https://domestic.com.et`, `https://domestic-hub.vercel.app`, and localhost dev ports — see `.env.example`.
- To attach the domain on Vercel (where this repo previews deploy): Vercel dashboard → project **domestic-hub** → Settings → Domains → add `afro-link.domestic.com.et`; then at the DNS host for `domestic.com.et`, create the record Vercel shows (typically `CNAME afro-link → cname.vercel-dns.com`).
- Health check: `GET /health` reports `{ status, service, domain }`.

## Roadmap

- `apps/web` — shipper dashboard and driver app (Amharic/English).
- Real Telebirr / CBE Birr payout adapters behind the advance state machine.
- Real LLM adapter (e.g. Mistral) behind the agent's `LlmAdapter` interface, plus voice input.
- Persistent storage (PostgreSQL) replacing the in-memory repo, plus auth via DomesticHub SSO.
