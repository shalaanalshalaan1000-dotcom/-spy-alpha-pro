# SPY Alpha Pro V4 — Mobile Ready

Flat Render build: no `src/` and no `public/` folders.

The dashboard is gold-first. Its fixed equity/ETF list is `SPY`, `QQQ`, `IWM`, and `NVDA`; a separate automatic radar can temporarily add verified speculative stocks with active options.

## XAUUSD spot reading

The dashboard includes a separate XAU/USD spot panel, intentionally outside the stock/options selector. It shows the current ounce price, source freshness, a short rolling direction, and a 15-minute OANDA chart from TradingView. It never creates or suggests gold option contracts.

- Spot price source: `https://api.gold-api.com/price/XAU`
- Browser refresh: 30 seconds (the source allows cross-origin reads and publishes a short public cache)
- Samples are retained locally in the browser for up to two hours so a reload does not immediately discard the observation window.
- The 15-minute target model fits a short price channel and estimates recent realized movement. Directional targets remain hidden until at least 15 minutes of data exists and confidence reaches 75%.
- Target arrival is shown as a time range and is conditional on momentum continuing; the invalidation level cancels the scenario.
- The short direction and target model are analytical estimates, not trade guarantees.
- Gold API and the OANDA/TradingView chart can differ slightly because they are separate feeds.

## Automatic speculative options radar

The live radar pulls the top US stock gainers and losers from Massive, then applies minimum price, absolute daily move, share-volume, and dollar-volume filters. It verifies every displayed ticker against Massive's active options-contract reference endpoint before adding it to the selector. Up to six names are cached for 15 minutes; the four fixed symbols remain unchanged.

The automatic Telegram worker considers both the four fixed symbols and current verified radar symbols. Demo mode does not invent speculative candidates.

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
