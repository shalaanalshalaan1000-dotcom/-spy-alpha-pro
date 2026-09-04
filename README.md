# SPY Alpha Pro V4 — Mobile Ready

Flat Render build: no `src/` and no `public/` folders.

The dashboard is gold-first. Its four core equity/ETF symbols are `SPY`, `QQQ`, `IWM`, and `NVDA`. `SPX` is available as a separate 0DTE index path, while an automatic radar can temporarily add verified speculative stocks with active options.

## XAUUSD spot reading

The dashboard includes a separate XAU/USD spot panel, intentionally outside the stock/options selector. It shows the current ounce price, source freshness, a short rolling direction, and a 1-minute OANDA chart from TradingView. It never creates or suggests gold option contracts.

- Preferred spot source: Massive Forex last quote for `C:XAUUSD` (requires Massive Currencies real-time access).
- Automatic fallbacks: Gold API first, then GoldPrice.org when the Massive key has no currency entitlement or another feed is unavailable.
- Browser refresh: five seconds. The server shares a short cache across visitors, keeps the last valid quote visible while refreshing in the background, and backs off briefly after provider failures. The fallback sources normally publish a new value about every 30 seconds, which the UI labels explicitly.
- Samples are retained locally in the browser for up to two hours (up to 1,440 five-second observations) so a reload does not immediately discard the observation window.
- The live target model fits a short price channel and estimates recent realized movement. Directional targets remain hidden until at least one minute of data exists and confidence reaches 75%.
- Estimated arrival is shown for the first targets and remains conditional on momentum continuing; the invalidation level cancels the scenario.
- Every locked Gold or Bitcoin setup now carries four progressively wider targets. Reaching a target marks it as achieved and advances the live tracker to the next target without clearing the setup after target one or two.
- The short direction and target model are analytical estimates, not trade guarantees.
- Massive/Gold API and the OANDA/TradingView chart can differ slightly because they are separate feeds.

## JustMarkets MT5 demo execution

The server exposes a short-lived, deterministic gold signal at `/api/auto-trade/signal`. The included `mt5/GoldAlphaExecutor.mq5` Expert Advisor polls that endpoint from MetaTrader 5, sizes positions from equity risk, rejects stale or duplicate signals, and manages the stop through four target levels.

The EA is locked to demo accounts by default. Broker credentials remain inside MT5 and must never be placed in this repository or in Render. See `JUSTMARKETS_MT5_SETUP.md` for installation and safety settings.

## Automatic speculative options radar

The live radar pulls the top US stock gainers and losers from Massive, then applies minimum price, absolute daily move, share-volume, and dollar-volume filters. It verifies every displayed ticker against Massive's active options-contract reference endpoint before adding it to the selector. Up to six names are cached for 15 minutes; the four fixed symbols remain unchanged.

The automatic Telegram worker considers the four core symbols, the independent SPX path, and current verified radar symbols. Demo mode does not invent speculative candidates.

## Independent SPX 0DTE path

SPX does not reuse the core ETF rules. Its market bars are requested from Massive as `I:SPX`, while its option-chain underlying is `SPX`.

- Suggestions are enabled only from 15:30 through 15:58 ET on US trading days.
- Only same-day-expiration (`0DTE`) contracts are requested.
- A suggested contract must be strictly OTM and priced at no more than `$1.50` (`$150` per contract before fees).
- The regular minimum confidence remains 70%, and contracts must pass the existing spread and liquidity checks.
- Because an index has no share volume, SPX VWAP/RVOL confirmation uses aligned `SPY` volume as a market-activity reference.
- Outside the time window, or when the data is stale, SPX remains `NO TRADE` and no contract is suggested.
- Massive Indices access is required. Indices Starter provides 15-minute-delayed intraday data; an EOD-only index plan is intentionally treated as stale during the session.

If index access is unavailable, only the SPX row shows an entitlement warning; `SPY`, `QQQ`, `IWM`, and `NVDA` continue loading normally.

## Required Render environment variable
- `MASSIVE_API_KEY` — the existing stock features use the stock entitlement; true one-second XAUUSD quotes additionally require Massive Currencies real-time access on the same key.

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
