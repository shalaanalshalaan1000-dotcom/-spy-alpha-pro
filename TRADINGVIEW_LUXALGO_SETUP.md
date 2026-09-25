# TradingView ICT Concepts [LuxAlgo] -> Gold Alpha

The site now has a dedicated receiver for ICT events:

`POST https://spy-alpha-pro-1.onrender.com/api/tradingview/luxalgo`

Debug state:

`GET https://spy-alpha-pro-1.onrender.com/api/tradingview/luxalgo/state`

## Why a bridge is required

A website cannot read the labels/boxes painted inside another TradingView indicator. TradingView must emit the indicator's events through alerts. The site then uses those events as an external confirmation layer before a new XAUUSD entry.

## Timeframe contract

Create the same alert-enabled personal copy on:

- 1H: higher-timeframe MSS/BOS context
- 15m: confirmation/context
- 5m: execution structure + displacement + FVG
- 1m: optional execution timing

The strict site gate is intentionally disabled until all required TradingView alerts are connected. While disabled, incoming LuxAlgo events are recorded and shown as OBSERVE only; they do not alter production entries.

Once `LUXALGO_REQUIRED=true`, a new site candidate is blocked unless:

1. fresh H1 MSS/BOS is aligned with the candidate;
2. fresh M15 MSS/BOS is aligned;
3. fresh M5 MSS/BOS is aligned;
4. same-side M5 displacement exists;
5. same-side M5 FVG exists;
6. if a fresh M1 structure event exists, it must not oppose the candidate.

This gate runs before `maybeCreate()`, so a blocked candidate is not registered as a live trade and is not sent to Telegram.

## TradingView setup

1. Open the open-source `ICT Concepts [LuxAlgo]` source in TradingView and save a personal copy.
2. Append `tradingview-luxalgo-webhook-patch.pine` to the end of that copy.
3. Enter the Render webhook secret in the new **Gold Alpha Webhook** input.
4. Add the copied indicator to XAUUSD 1H, 15m and 5m. Add 1m if wanted.
5. For each timeframe create an alert:
   - Condition: the copied indicator
   - Trigger: **Any alert() function call**
   - Webhook URL: `https://spy-alpha-pro-1.onrender.com/api/tradingview/luxalgo`
6. Keep the alert active on TradingView servers. No message body is required in the Alert dialog because the Pine bridge creates the JSON dynamically.
7. Verify the state endpoint shows `connected: true` and the expected frames.

Do not turn strict mode on until H1, 15m and 5m events are reaching the receiver.
