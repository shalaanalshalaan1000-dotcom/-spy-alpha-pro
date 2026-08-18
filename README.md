# SPY Alpha Pro V4 — Mobile Ready

Flat Render build: no `src/` and no `public/` folders.

## XAUUSD spot reading

The dashboard includes a separate XAU/USD spot panel, intentionally outside the stock/options selector. It shows the current ounce price, source freshness, a short rolling direction, and a 5-minute OANDA chart from TradingView. It never creates or suggests gold option contracts.

- Spot price source: `https://api.gold-api.com/price/XAU`
- Browser refresh: 30 seconds (the source allows cross-origin reads and publishes a short public cache)
- The short direction is only the movement across samples collected since the user opened the dashboard; it is not a trade signal.
- Gold API and the OANDA/TradingView chart can differ slightly because they are separate feeds.

## Required Render environment variable
- `MASSIVE_API_KEY`

## Optional
- `MIN_CONFIDENCE=70`
- `OPTIONS_MAX_DTE=14`
- `OPTIONS_STRIKE_WINDOW_PCT=0.10`
- `RISK_FREE_RATE=0.04`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

## Private access by email

The app supports Google OAuth with a server-side email allowlist. Add these Render environment variables, then switch `AUTH_ENABLED` to `true` only after all values are present:

- `ALLOWED_EMAILS` — comma-separated Google account emails
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SESSION_SECRET` — random value of at least 32 characters
- `APP_BASE_URL=https://spy-alpha-pro-1.onrender.com`

Register this Google OAuth redirect URI:

`https://spy-alpha-pro-1.onrender.com/auth/google/callback`

When access control is enabled, the dashboard and every data API require a signed session. `/api/health` remains public for Render health checks.

## Automatic Telegram signals

After `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set, the server scans during regular US market hours and sends only fully analyzed CALL/PUT setups. Defaults:

- confidence at least 70%
- risk/reward at least 1:2
- maximum 3 signals per trading day
- 90-minute global cooldown
- 5-minute scan interval

The previous public arbitrary-message endpoint was removed. Authenticated owners can test the connection with `POST /api/telegram/test`; status is available at `GET /api/telegram/status`.

Because the Render service uses the free plan, `.github/workflows/telegram-signals.yml` wakes it every five minutes during weekday market hours. The trigger uses GitHub Actions OIDC, validates the exact repository, workflow, branch, event, audience, signature, and token lifetime, and does not require a stored wake-up secret.

## Health check
Open `/api/health` after deploy. `mode` should be `LIVE` when `MASSIVE_API_KEY` exists.

## Notes
If the Massive plan does not permit an Options Chain Snapshot, stock analysis still runs and the UI reports that option-chain data is unavailable rather than crashing.
