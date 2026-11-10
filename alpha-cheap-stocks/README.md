# Alpha Cheap Stocks — 1500 Scanner

Standalone scanner built on a separate Git branch so it does not alter the production gold/BTC runtime on `main`.

## What changed

- Scans the Massive full U.S. stock-market snapshot in one request.
- Loads active company metadata and keeps common shares / ADR common shares.
- Excludes OTC.
- Keeps stocks priced from $1 to $5.
- Applies minimum liquidity filters.
- Builds a liquid universe of up to 1,500 companies.
- Scores the universe from 0–100.
- Shows the Top 20 and a single #1 BEST STOCK NOW candidate.
- Cash-long ranking only; it does not place orders.

## Ranking inputs

- Dollar liquidity
- Share volume
- Positive intraday momentum
- Distance to day high
- Intraday range
- Time-adjusted relative volume
- Price versus daily VWAP
- Data freshness penalty

## Environment

```
MASSIVE_API_KEY=...
PORT=3000
```

## Run

```bash
cd alpha-cheap-stocks
npm start
```

Open `http://localhost:3000`.

## API

- `GET /api/health`
- `GET /api/scan`
- `GET /api/scan?force=1`

The scan response reports the total market rows received, eligible $1–$5 companies, actual universe size, Top 20, and the current #1 candidate.

## Safety

This scanner ranks market data; it is not an execution engine and does not guarantee performance.
