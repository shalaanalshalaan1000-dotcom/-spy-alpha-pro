#property strict
#property version   "2.12"
#property description "Gold Alpha Pro - JustMarkets margin-safe executor for small Standard Cent accounts"

#include <Trade/Trade.mqh>

input string SignalUrl              = "https://spy-alpha-pro-1.onrender.com/api/auto-trade/signal";
input string ReportUrl              = "https://spy-alpha-pro-1.onrender.com/api/auto-trade/report";
input string TradeSymbol            = "";
input bool   RequireJustMarkets      = true;
input bool   RequireGoldSymbol       = true;
input bool   RequireCentAccount      = true;
input bool   EnableTrading           = false;
input bool   AllowLiveAccount        = false;
input double RiskPercent             = 1.00;
input double MaxDailyLossPercent     = 3.00;
input double MaxLot                  = 0.01;
input double MinMarginLevelPercent   = 500.0;
input double MinFreeMarginReservePct = 50.0;
input double MaxSpreadPrice          = 0.80;
input int    PollSeconds             = 5;
input int    RequestTimeoutMs        = 15000;
input int    DeviationPoints         = 30;
input ulong  MagicNumber             = 26090412;

CTrade trade;
string g_symbol;
string g_prefix;
datetime g_day_start=0;
double g_day_start_equity=0.0;

string Key(const string suffix){ return g_prefix+suffix; }
void SaveValue(const string name,const double value){ GlobalVariableSet(Key(name),value); }
double LoadValue(const string name,const double fallback=0.0){ return GlobalVariableCheck(Key(name))?GlobalVariableGet(Key(name)):fallback; }

string JsonString(const string json,const string key)
{
   string token="\""+key+"\"";
   int p=StringFind(json,token); if(p<0) return "";
   p=StringFind(json,":",p+StringLen(token)); if(p<0) return "";
   int q1=StringFind(json,"\"",p+1); if(q1<0) return "";
   int q2=q1+1;
   while(q2<StringLen(json))
   {
      if(StringSubstr(json,q2,1)=="\"" && StringSubstr(json,q2-1,1)!="\\") break;
      q2++;
   }
   if(q2>=StringLen(json)) return "";
   return StringSubstr(json,q1+1,q2-q1-1);
}

double JsonNumber(const string json,const string key,const double fallback=0.0)
{
   string token="\""+key+"\"";
   int p=StringFind(json,token); if(p<0) return fallback;
   p=StringFind(json,":",p+StringLen(token)); if(p<0) return fallback;
   p++;
   while(p<StringLen(json) && (StringSubstr(json,p,1)==" " || StringSubstr(json,p,1)=="\t")) p++;
   int e=p;
   while(e<StringLen(json))
   {
      string c=StringSubstr(json,e,1);
      if(StringFind("-+.0123456789eE",c)<0) break;
      e++;
   }
   if(e<=p) return fallback;
   return StringToDouble(StringSubstr(json,p,e-p));
}

bool HttpGet(const string url,string &body)
{
   char payload[],response[]; string headers;
   ResetLastError();
   int status=WebRequest("GET",url,"Accept: application/json\r\n",RequestTimeoutMs,payload,response,headers);
   if(status==-1){ Print("GET failed: ",GetLastError()); return false; }
   if(status!=200){ Print("GET HTTP ",status); return false; }
   body=CharArrayToString(response,0,-1,CP_UTF8);
   return true;
}

bool IsGoldSymbol(const string symbol)
{
   string s=symbol; StringToUpper(s);
   return StringFind(s,"XAU")>=0 || StringFind(s,"GOLD")>=0;
}

bool IsJustMarketsBroker()
{
   string company=AccountInfoString(ACCOUNT_COMPANY);
   string server=AccountInfoString(ACCOUNT_SERVER);
   StringToUpper(company); StringToUpper(server);
   return StringFind(company,"JUSTMARKETS")>=0 || StringFind(company,"JUST GLOBAL")>=0 ||
          StringFind(server,"JUSTMARKETS")>=0 || StringFind(server,"JUST GLOBAL")>=0;
}

bool TradingEnvironmentReady()
{
   return (bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) &&
          (bool)MQLInfoInteger(MQL_TRADE_ALLOWED) &&
          (bool)AccountInfoInteger(ACCOUNT_TRADE_ALLOWED);
}

datetime StartOfServerDay()
{
   MqlDateTime t; TimeToStruct(TimeTradeServer(),t);
   t.hour=0; t.min=0; t.sec=0;
   return StructToTime(t);
}

void RefreshDailyEquity()
{
   datetime today=StartOfServerDay();
   if(today!=g_day_start)
   {
      g_day_start=today;
      g_day_start_equity=AccountInfoDouble(ACCOUNT_EQUITY);
      SaveValue("day",(double)today);
      SaveValue("day_equity",g_day_start_equity);
   }
}

bool DailyLossLimitReached()
{
   RefreshDailyEquity();
   if(g_day_start_equity<=0.0) return true;
   double equity=AccountInfoDouble(ACCOUNT_EQUITY);
   double loss=100.0*(g_day_start_equity-equity)/g_day_start_equity;
   if(loss>=MaxDailyLossPercent)
   {
      Print("BLOCKED: daily loss limit reached: ",DoubleToString(loss,2),"%");
      return true;
   }
   return false;
}

bool HasAnyPositionOnSymbol(){ return PositionSelect(g_symbol); }

int VolumeDigits(const double step)
{
   int digits=0; double x=step;
   while(digits<8 && MathAbs(x-MathRound(x))>1e-8){ x*=10.0; digits++; }
   return digits;
}

double RiskVolume(const double entry,const double stop)
{
   double distance=MathAbs(entry-stop);
   double tick_size=SymbolInfoDouble(g_symbol,SYMBOL_TRADE_TICK_SIZE);
   double tick_value=SymbolInfoDouble(g_symbol,SYMBOL_TRADE_TICK_VALUE_LOSS);
   double step=SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_STEP);
   double minimum=SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_MIN);
   double broker_max=SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_MAX);
   if(distance<=0 || tick_size<=0 || tick_value<=0 || step<=0 || minimum<=0) return 0.0;

   double risk_cash=AccountInfoDouble(ACCOUNT_EQUITY)*RiskPercent/100.0;
   double cash_per_lot=(distance/tick_size)*tick_value;
   if(cash_per_lot<=0) return 0.0;

   double raw=risk_cash/cash_per_lot;
   double cap=MathMin(MaxLot,broker_max);
   double volume=MathFloor(MathMin(raw,cap)/step)*step;
   if(volume+1e-9<minimum) return 0.0;
   return NormalizeDouble(volume,VolumeDigits(step));
}

bool MarginSafe(const ENUM_ORDER_TYPE type,const double volume,const double price)
{
   if(volume<=0) return false;

   double required_margin=0.0;
   if(!OrderCalcMargin(type,g_symbol,volume,price,required_margin))
   {
      Print("BLOCKED: OrderCalcMargin failed. Error ",GetLastError());
      return false;
   }

   double equity=AccountInfoDouble(ACCOUNT_EQUITY);
   double margin=AccountInfoDouble(ACCOUNT_MARGIN);
   double free_margin=AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   double projected_margin=margin+required_margin;
   double projected_level=(projected_margin>0.0)?(equity/projected_margin*100.0):999999.0;
   double reserve_needed=equity*MinFreeMarginReservePct/100.0;
   double projected_free=free_margin-required_margin;

   if(projected_level<MinMarginLevelPercent)
   {
      Print("BLOCKED: projected margin level ",DoubleToString(projected_level,1),"% < ",DoubleToString(MinMarginLevelPercent,1),"%");
      return false;
   }
   if(projected_free<reserve_needed)
   {
      Print("BLOCKED: free-margin reserve too low. Projected=",DoubleToString(projected_free,2)," required reserve=",DoubleToString(reserve_needed,2));
      return false;
   }
   return true;
}

bool PriceInside(const double price,const double low,const double high)
{
   return price>=MathMin(low,high) && price<=MathMax(low,high);
}

void ProcessSignal()
{
   if(DailyLossLimitReached()) return;
   if(HasAnyPositionOnSymbol()) return; // exactly one XAUUSD position at a time

   string json;
   if(!HttpGet(SignalUrl,json)) return;

   string status=JsonString(json,"status");
   string action=JsonString(json,"action");
   string side=JsonString(json,"side");
   long issued=(long)JsonNumber(json,"issuedAtMs",0.0);
   long expires=(long)JsonNumber(json,"expiresAtMs",0.0);
   long now_ms=(long)TimeGMT()*1000;

   if(status!="ACTIVE" || action!=side || (side!="BUY" && side!="SELL")) return;
   if(issued<=0 || expires<=now_ms) return;
   if((long)LoadValue("last_signal",0.0)==issued) return;

   MqlTick tick;
   if(!SymbolInfoTick(g_symbol,tick)) return;
   if(tick.ask-tick.bid>MaxSpreadPrice){ Print("BLOCKED: spread too wide."); return; }

   double entry_low=JsonNumber(json,"entryLow");
   double entry_high=JsonNumber(json,"entryHigh");
   double stop=JsonNumber(json,"stopLoss");
   double tp4=JsonNumber(json,"target4");
   double price=(side=="BUY")?tick.ask:tick.bid;

   if(!PriceInside(price,entry_low,entry_high) || stop<=0 || tp4<=0) return;
   if((side=="BUY" && (stop>=price || tp4<=price)) ||
      (side=="SELL" && (stop<=price || tp4>=price))) return;

   bool live=(AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_REAL);
   if(!EnableTrading || (live && !AllowLiveAccount))
   {
      Print("Validated signal only; trading disabled.");
      SaveValue("last_signal",(double)issued);
      return;
   }
   if(!TradingEnvironmentReady()){ Print("BLOCKED: terminal/account trading permission."); return; }

   double volume=RiskVolume(price,stop);
   if(volume<=0.0)
   {
      Print("BLOCKED: broker minimum lot would exceed risk cap. No trade.");
      return;
   }

   ENUM_ORDER_TYPE order_type=(side=="BUY")?ORDER_TYPE_BUY:ORDER_TYPE_SELL;
   if(!MarginSafe(order_type,volume,price)) return;

   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetDeviationInPoints(DeviationPoints);
   trade.SetTypeFillingBySymbol(g_symbol);

   bool sent=(side=="BUY") ? trade.Buy(volume,g_symbol,0.0,stop,tp4,"Gold Alpha SAFE")
                            : trade.Sell(volume,g_symbol,0.0,stop,tp4,"Gold Alpha SAFE");
   if(!sent)
   {
      Print("Order failed: ",trade.ResultRetcodeDescription());
      return;
   }

   SaveValue("last_signal",(double)issued);
   Print("SAFE OPEN: ",side," ",DoubleToString(volume,2)," lot; projected margin guard passed.");
}

int OnInit()
{
   g_symbol=(TradeSymbol=="")?_Symbol:TradeSymbol;

   if(RequireGoldSymbol && !IsGoldSymbol(g_symbol))
   {
      Print("Attach to JustMarkets gold chart only. Current symbol: ",g_symbol);
      return INIT_FAILED;
   }
   if(RequireJustMarkets && !IsJustMarketsBroker())
   {
      Print("JustMarkets account/server not detected.");
      return INIT_FAILED;
   }
   if(RequireCentAccount && AccountInfoString(ACCOUNT_CURRENCY)!="USC")
   {
      Print("Small-balance profile requires Standard Cent (USC). Detected: ",AccountInfoString(ACCOUNT_CURRENCY));
      return INIT_FAILED;
   }
   if(!SymbolSelect(g_symbol,true)) return INIT_FAILED;

   g_prefix="GOLDAP_SAFE_"+(string)AccountInfoInteger(ACCOUNT_LOGIN)+"_"+g_symbol+"_";
   g_day_start=(datetime)LoadValue("day",0.0);
   g_day_start_equity=LoadValue("day_equity",0.0);
   RefreshDailyEquity();

   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetDeviationInPoints(DeviationPoints);
   trade.SetTypeFillingBySymbol(g_symbol);
   EventSetTimer(MathMax(PollSeconds,1));

   Print("GoldAlpha JustMarkets SAFE v2.12 active. Risk=",DoubleToString(RiskPercent,2),"%, MaxLot=",DoubleToString(MaxLot,2),", MinMarginLevel=",DoubleToString(MinMarginLevelPercent,0),"%");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason){ EventKillTimer(); }
void OnTimer(){ ProcessSignal(); }
