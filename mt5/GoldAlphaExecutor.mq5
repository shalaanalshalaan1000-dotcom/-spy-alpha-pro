#property strict
#property version   "1.00"
#property description "Demo-only XAUUSD executor for SPY Alpha Pro"

#include <Trade/Trade.mqh>

input string SignalUrl            = "https://spy-alpha-pro-1.onrender.com/api/auto-trade/signal";
input string TradeSymbol          = "";       // Blank: use the chart symbol (recommended).
input bool   EnableDemoTrading     = true;
input bool   RequireDemoAccount    = true;     // Keep true until the strategy is independently validated.
input double RiskPercent          = 0.25;      // Maximum equity risk per trade.
input double MaxDailyLossPercent  = 1.00;      // Stop opening trades after this daily equity loss.
input double MaxSpreadPrice       = 0.80;      // Maximum ask-bid difference in price units.
input int    PollSeconds          = 5;
input int    RequestTimeoutMs     = 15000;
input int    DeviationPoints      = 30;
input ulong  MagicNumber          = 26090401;

CTrade trade;
string g_symbol;
string g_prefix;
datetime g_day_start;
double g_day_start_equity = 0.0;

string Key(const string suffix) { return g_prefix + suffix; }

void SaveValue(const string name, const double value) { GlobalVariableSet(Key(name), value); }
double LoadValue(const string name, const double fallback = 0.0)
{
   return GlobalVariableCheck(Key(name)) ? GlobalVariableGet(Key(name)) : fallback;
}

string JsonString(const string json, const string key)
{
   string token = "\"" + key + "\"";
   int p = StringFind(json, token);
   if(p < 0) return "";
   p = StringFind(json, ":", p + StringLen(token));
   if(p < 0) return "";
   int q1 = StringFind(json, "\"", p + 1);
   if(q1 < 0) return "";
   int q2 = q1 + 1;
   while(q2 < StringLen(json))
   {
      if(StringSubstr(json, q2, 1) == "\"" && StringSubstr(json, q2 - 1, 1) != "\\") break;
      q2++;
   }
   if(q2 >= StringLen(json)) return "";
   return StringSubstr(json, q1 + 1, q2 - q1 - 1);
}

double JsonNumber(const string json, const string key, const double fallback = 0.0)
{
   string token = "\"" + key + "\"";
   int p = StringFind(json, token);
   if(p < 0) return fallback;
   p = StringFind(json, ":", p + StringLen(token));
   if(p < 0) return fallback;
   p++;
   while(p < StringLen(json) && (StringSubstr(json, p, 1) == " " || StringSubstr(json, p, 1) == "\t")) p++;
   int e = p;
   while(e < StringLen(json))
   {
      string c = StringSubstr(json, e, 1);
      if(StringFind("-+.0123456789eE", c) < 0) break;
      e++;
   }
   if(e <= p) return fallback;
   return StringToDouble(StringSubstr(json, p, e - p));
}

bool FetchSignal(string &json)
{
   char payload[];
   char response[];
   string headers;
   ResetLastError();
   int status = WebRequest("GET", SignalUrl, "Accept: application/json\r\n", RequestTimeoutMs,
                           payload, response, headers);
   if(status == -1)
   {
      Print("Signal request failed (", GetLastError(), "). Add https://spy-alpha-pro-1.onrender.com to Tools > Options > Expert Advisors > Allow WebRequest.");
      return false;
   }
   if(status != 200)
   {
      Print("Signal endpoint returned HTTP ", status);
      return false;
   }
   json = CharArrayToString(response, 0, -1, CP_UTF8);
   return true;
}

datetime StartOfServerDay()
{
   MqlDateTime now;
   TimeToStruct(TimeTradeServer(), now);
   now.hour = 0; now.min = 0; now.sec = 0;
   return StructToTime(now);
}

void RefreshDailyEquity()
{
   datetime today = StartOfServerDay();
   if(today != g_day_start)
   {
      g_day_start = today;
      g_day_start_equity = AccountInfoDouble(ACCOUNT_EQUITY);
      SaveValue("day", (double)today);
      SaveValue("day_equity", g_day_start_equity);
   }
}

bool DailyLossLimitReached()
{
   RefreshDailyEquity();
   if(g_day_start_equity <= 0.0) return true;
   double loss = 100.0 * (g_day_start_equity - AccountInfoDouble(ACCOUNT_EQUITY)) / g_day_start_equity;
   return loss >= MaxDailyLossPercent;
}

int VolumeDigits(const double step)
{
   int digits = 0;
   double scaled = step;
   while(digits < 8 && MathAbs(scaled - MathRound(scaled)) > 1e-8)
   {
      scaled *= 10.0;
      digits++;
   }
   return digits;
}

double RiskVolume(const double entry, const double stop)
{
   double distance = MathAbs(entry - stop);
   double tick_size = SymbolInfoDouble(g_symbol, SYMBOL_TRADE_TICK_SIZE);
   double tick_value = SymbolInfoDouble(g_symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
   double step = SymbolInfoDouble(g_symbol, SYMBOL_VOLUME_STEP);
   double minimum = SymbolInfoDouble(g_symbol, SYMBOL_VOLUME_MIN);
   double maximum = SymbolInfoDouble(g_symbol, SYMBOL_VOLUME_MAX);
   if(distance <= 0.0 || tick_size <= 0.0 || tick_value <= 0.0 || step <= 0.0) return 0.0;

   double risk_cash = AccountInfoDouble(ACCOUNT_EQUITY) * RiskPercent / 100.0;
   double cash_per_lot = (distance / tick_size) * tick_value;
   double raw = risk_cash / cash_per_lot;
   double volume = MathFloor(raw / step) * step;
   if(volume + 1e-9 < minimum) return 0.0; // Never round up beyond the risk cap.
   volume = MathMin(volume, maximum);
   return NormalizeDouble(volume, VolumeDigits(step));
}

bool HasManagedPosition()
{
   if(!PositionSelect(g_symbol)) return false;
   return (ulong)PositionGetInteger(POSITION_MAGIC) == MagicNumber;
}

bool HasAnyPosition() { return PositionSelect(g_symbol); }

void ManagePosition()
{
   if(!HasManagedPosition()) return;
   long type = PositionGetInteger(POSITION_TYPE);
   double current = type == POSITION_TYPE_BUY ? SymbolInfoDouble(g_symbol, SYMBOL_BID)
                                               : SymbolInfoDouble(g_symbol, SYMBOL_ASK);
   double open = PositionGetDouble(POSITION_PRICE_OPEN);
   double sl = PositionGetDouble(POSITION_SL);
   double tp = PositionGetDouble(POSITION_TP);
   double t1 = LoadValue("tp1"), t2 = LoadValue("tp2"), t3 = LoadValue("tp3");
   if(t1 <= 0 || t2 <= 0 || t3 <= 0) return;

   double next_sl = sl;
   bool buy = type == POSITION_TYPE_BUY;
   if((buy && current >= t3) || (!buy && current <= t3)) next_sl = t2;
   else if((buy && current >= t2) || (!buy && current <= t2)) next_sl = t1;
   else if((buy && current >= t1) || (!buy && current <= t1)) next_sl = open;

   bool improves = buy ? (next_sl > sl + _Point) : (sl == 0.0 || next_sl < sl - _Point);
   if(improves && !trade.PositionModify(g_symbol, next_sl, tp))
      Print("Stop update failed: ", trade.ResultRetcodeDescription());
}

bool PriceInside(const double price, const double low, const double high)
{
   return price >= MathMin(low, high) && price <= MathMax(low, high);
}

void ProcessSignal()
{
   ManagePosition();
   // Do not mix this EA with a manual or another automated position on the symbol.
   if(!EnableDemoTrading || DailyLossLimitReached() || HasAnyPosition()) return;

   string json;
   if(!FetchSignal(json)) return;
   string status = JsonString(json, "status");
   string action = JsonString(json, "action");
   string side = JsonString(json, "side");
   long issued = (long)JsonNumber(json, "issuedAtMs", 0.0);
   long expires = (long)JsonNumber(json, "expiresAtMs", 0.0);
   long now_ms = (long)TimeGMT() * 1000;
   if(status != "ACTIVE" || action != side || (side != "BUY" && side != "SELL") || issued <= 0 || expires <= now_ms) return;
   if((long)LoadValue("last_signal", 0.0) == issued) return;

   MqlTick tick;
   if(!SymbolInfoTick(g_symbol, tick)) return;
   if(tick.ask - tick.bid > MaxSpreadPrice) return;

   double entry_low = JsonNumber(json, "entryLow");
   double entry_high = JsonNumber(json, "entryHigh");
   double stop = JsonNumber(json, "stop");
   double tp1 = JsonNumber(json, "tp1");
   double tp2 = JsonNumber(json, "tp2");
   double tp3 = JsonNumber(json, "tp3");
   double tp4 = JsonNumber(json, "tp4");
   double price = side == "BUY" ? tick.ask : tick.bid;
   if(!PriceInside(price, entry_low, entry_high) || stop <= 0 || tp4 <= 0) return;
   if((side == "BUY" && (stop >= price || tp4 <= price)) ||
      (side == "SELL" && (stop <= price || tp4 >= price))) return;

   double volume = RiskVolume(price, stop);
   if(volume <= 0.0)
   {
      Print("Trade skipped: broker minimum lot would exceed the configured risk.");
      return;
   }

   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetDeviationInPoints(DeviationPoints);
   bool sent = side == "BUY" ? trade.Buy(volume, g_symbol, 0.0, stop, tp4, "SPY Alpha Gold")
                              : trade.Sell(volume, g_symbol, 0.0, stop, tp4, "SPY Alpha Gold");
   if(!sent)
   {
      Print("Order failed: ", trade.ResultRetcodeDescription());
      return;
   }

   SaveValue("last_signal", (double)issued);
   SaveValue("tp1", tp1); SaveValue("tp2", tp2);
   SaveValue("tp3", tp3); SaveValue("tp4", tp4);
   Print("Opened ", side, " ", DoubleToString(volume, 2), " lots on ", g_symbol,
         "; SL=", DoubleToString(stop, _Digits), "; TP=", DoubleToString(tp4, _Digits));
}

int OnInit()
{
   g_symbol = TradeSymbol == "" ? _Symbol : TradeSymbol;
   if(RequireDemoAccount && AccountInfoInteger(ACCOUNT_TRADE_MODE) != ACCOUNT_TRADE_MODE_DEMO)
   {
      Alert("GoldAlphaExecutor is locked to demo accounts. Attach it to a JustMarkets demo account.");
      return INIT_FAILED;
   }
   if(!SymbolSelect(g_symbol, true)) return INIT_FAILED;
   g_prefix = "SPYAP_" + (string)AccountInfoInteger(ACCOUNT_LOGIN) + "_" + g_symbol + "_";
   g_day_start = (datetime)LoadValue("day", 0.0);
   g_day_start_equity = LoadValue("day_equity", 0.0);
   RefreshDailyEquity();
   EventSetTimer(MathMax(PollSeconds, 1));
   Print("GoldAlphaExecutor active on ", g_symbol, " (demo lock: ", RequireDemoAccount, ")");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { EventKillTimer(); }
void OnTimer() { ProcessSignal(); }
void OnTick() { ManagePosition(); }
