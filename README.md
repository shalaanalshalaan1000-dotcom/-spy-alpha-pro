# SPY Alpha Pro V3

Options scanner for large-cap U.S. names. It analyzes the underlying first, then selects and prices a liquid option contract.

## Watchlist
SPY, NVDA, QQQ, IWM, AAPL, MSFT, AMZN, META, GOOGL, TSLA, AMD, AVGO, NFLX, UNH.

## Core engine
- Daily ATR(14), ATR%, consumed and remaining ATR
- PDH/PDL, previous close, 20-day swing high/low, whole-dollar pivots
- VWAP, EMA 9/20, RSI(14), RVOL
- Liquidity sweeps, MSS/BOS, FVG
- CALL / PUT / WATCH / NO TRADE with confidence
- Stock target and invalidation based on structure + ATR
- Option selection by DTE, liquidity, spread, OI, volume, delta, proximity to ATM and premium
- Contract target/stop estimated from live mid + delta/gamma/theta, with Black-Scholes fallback
- Minimum RR penalty below 1:2
- Data freshness guard
- Optional Telegram endpoint

## LIVE data
Set `MASSIVE_API_KEY`. The app uses Massive official REST endpoints for stock aggregate bars and the option-chain snapshot. Without a key it runs in DEMO mode.

## Run
```bash
npm install
npm start
```
Open http://localhost:3000

## Deploy
A `Dockerfile` and `render.yaml` are included. Add `MASSIVE_API_KEY` as a secret environment variable on the host. Never place the API key in browser-side JavaScript.

## Important
This tool is decision support, not a guarantee of profit. Option premium estimates are model estimates and can diverge materially when IV, liquidity, spreads, or price gaps change.
