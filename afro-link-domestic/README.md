# Afro-Link Domestic

Asset-light, AI-powered freight marketplace connecting Ethiopian shippers with independent truck operators. Cuts empty return trips, gives drivers instant fuel advances through Telebirr/CBE Birr, and gives shippers live tracking and compliant VAT invoices. Part of DomesticHub (B2B, B2C, e-commerce, advertising, subscriptions) with the Domestic AI Agent.

## Structure

```
packages/
  shared/   Domain core: types, geo, load-matching engine, Ethiopian VAT, fuel-advance rules
  api/      Fastify marketplace API (loads, matches, shipments, tracking, advances, invoices)
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

## Domain rules baked into `@afro-link/shared`

- **Matching engine** ranks operators by empty-repositioning distance from their last drop-off, capacity fit, and backhaul potential near the destination.
- **Fuel advances** are capped at 20% of the load price, require an assigned load, one active advance per operator, and follow a strict state machine (`requested → approved → disbursed → recovered`, with `rejected`/`defaulted` terminal states).
- **VAT invoices** apply the 15% Ethiopian VAT rate and carry shipper/operator TINs for compliance.

## Roadmap

- `apps/web` — shipper dashboard and driver app (Amharic/English).
- `packages/agent` — Domestic AI Agent: conversational load posting, match explanations, ETA prediction.
- Real Telebirr / CBE Birr payout adapters behind the advance state machine.
- Persistent storage (PostgreSQL) replacing the in-memory repo, plus auth via DomesticHub SSO.
