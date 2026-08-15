# SPY Alpha Pro V4 — Mobile Ready

Flat Render build: no `src/` and no `public/` folders.

## Required Render environment variable
- `MASSIVE_API_KEY`

## Optional
- `MIN_CONFIDENCE=70`
- `OPTIONS_MAX_DTE=14`
- `OPTIONS_STRIKE_WINDOW_PCT=0.10`
- `RISK_FREE_RATE=0.04`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

## Health check
Open `/api/health` after deploy. `mode` should be `LIVE` when `MASSIVE_API_KEY` exists.

## Notes
If the Massive plan does not permit an Options Chain Snapshot, stock analysis still runs and the UI reports that option-chain data is unavailable rather than crashing.
