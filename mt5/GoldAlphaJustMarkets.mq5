#property strict
#property version   "2.10"
#property description "Gold Alpha Pro executor for JustMarkets MT5 (XAUUSD only)"

#include <Trade/Trade.mqh>

input string SignalUrl            = "https://spy-alpha-pro-1.onrender.com/api/auto-trade/signal";
input string ReportUrl            = "https://spy-alpha-pro-1.onrender.com/api/auto-trade/report";
input string TradeSymbol          = "";
input bool   RequireJustMarkets    = true;
input bool   RequireGoldSymbol     = true;
input bool   EnableTrading         = false;
input bool   AllowLiveAccount      = false;
input double RiskPercent           = 0.25;
input double MaxDailyLossPercent   = 1.00;
input double MaxSpreadPrice        = 0.80;
input int    PollSeconds           = 5;
input int    RequestTimeoutMs      = 15000;
input int    DeviationPoints       = 30;
input ulong  MagicNumber           = 26090401;

CTrade trade;
string g_symbol;
string g_prefix;
datetime g_day_start;
double g_day_start_equity=0.0;
datetime g_last_heartbeat=0;

string Key(const string suffix){ return g_prefix+suffix; }
void SaveValue(const string name,const double value){ GlobalVariableSet(Key(name),value); }
double LoadValue(const string name,const double fallback=0.0){ return GlobalVariableCheck(Key(name))?GlobalVariableGet(Key(name)):fallback; }

string JsonString(const string json,const string key)
{
   string token="\""+key+"\"";
   int p=StringFind(json,token);
   if(p<0) return "";
   p=StringFind(json,":",p+StringLen(token));
   if(p<0) return "";
   int q1=StringFind(json,"\"",p+1);
   if(q1<0) return "";
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
   int p=StringFind(json,token);
   if(p<0) return fallback;
   p=StringFind(json,":",p+StringLen(token));
   if(p<0) return fallback;
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

string BoolText(const bool value){ return value?"true":"false"; }

bool HttpGet(const string url,string &body)
{
   char payload[],response[];
   string headers;
   ResetLastError();
   int status=WebRequest("GET",url,"Accept: application/json\r\n",RequestTimeoutMs,payload,response,headers);
   if(status==-1){ Print("GET failed ",GetLastError()," for ",url); return false; }
   if(status!=200){ Print("GET HTTP ",status," for ",url); return false; }
   body=CharArrayToString(response,0,-1,CP_UTF8);
   return true;
}

bool HttpPostJson(const string url,const string body)
{
   char data[],response[];
   string headers;
   StringToCharArray(body,data,0,WHOLE_ARRAY,CP_UTF8);
   if(ArraySize(data)>0) ArrayResize(data,ArraySize(data)-1);
   ResetLastError();
   int status=WebRequest("POST",url,"Content-Type: application/json\r\nAccept: application/json\r\n",RequestTimeoutMs,data,response,headers);
   if(status==-1){ Print("POST failed ",GetLastError()," for ",url); return false; }
   if(status<200 || status>=300){ Print("POST HTTP ",status," for ",url); return false; }
   return true;
}

bool FetchSignal(string &json){ return HttpGet(SignalUrl,json); }

datetime StartOfServerDay()
{
   MqlDateTime now;
   TimeToStruct(TimeTradeServer(),now);
   now.hour=0; now.min=0; now.sec=0;
   return StructToTime(now);
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
   double loss=100.0*(g_day_start_equity-AccountInfoDouble(ACCOUNT_EQUITY))/g_day_start_equity;
   return loss>=MaxDailyLossPercent;
}

int VolumeDigits(const double step)
{
   int digits=0; double scaled=step;
   while(digits<8 && MathAbs(scaled-MathRound(scaled))>1e-8){ scaled*=10.0; digits++; }
   return digits;
}

double RiskVolume(const double entry,const double stop)
{
   double distance=MathAbs(entry-stop);
   double tick_size=SymbolInfoDouble(g_symbol,SYMBOL_TRADE_TICK_SIZE);
   double tick_value=SymbolInfoDouble(g_symbol,SYMBOL_TRADE_TICK_VALUE_LOSS);
   double step=SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_STEP);
   double minimum=SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_MIN);
   double maximum=SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_MAX);
   if(distance<=0.0 || tick_size<=0.0 || tick_value<=0.0 || step<=0.0) return 0.0;
   double risk_cash=AccountInfoDouble(ACCOUNT_EQUITY)*RiskPercent/100.0;
   double cash_per_lot=(distance/tick_size)*tick_value;
   double raw=risk_cash/cash_per_lot;
   double volume=MathFloor(raw/step)*step;
   if(volume+1e-9<minimum) return 0.0;
   volume=MathMin(volume,maximum);
   return NormalizeDouble(volume,VolumeDigits(step));
}

bool HasManagedPosition()
{
   if(!PositionSelect(g_symbol)) return false;
   return (ulong)PositionGetInteger(POSITION_MAGIC)==MagicNumber;
}
bool HasAnyPosition(){ return PositionSelect(g_symbol); }

void ReportHeartbeat()
{
   datetime now=TimeCurrent();
   if(now-g_last_heartbeat<10) return;
   g_last_heartbeat=now;
   bool live=AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_REAL;
   string body="{\"type\":\"HEARTBEAT\",\"symbol\":\""+g_symbol+"\",\"tradingEnabled\":"+BoolText(EnableTrading)+
               ",\"liveAccount\":"+BoolText(live)+",\"positionOpen\":"+BoolText(HasManagedPosition())+
               ",\"equity\":"+DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY),2)+"}";
   HttpPostJson(ReportUrl,body);
}

void ReportOpen(const string side,const double volume,const double stop,const double tp1,const double tp2,const double tp3,const double tp4)
{
   if(!PositionSelect(g_symbol)) return;
   long ticket=(long)PositionGetInteger(POSITION_TICKET);
   long position_id=(long)PositionGetInteger(POSITION_IDENTIFIER);
   double entry=PositionGetDouble(POSITION_PRICE_OPEN);
   string body="{\"type\":\"OPEN\",\"symbol\":\""+g_symbol+"\",\"ticket\":"+IntegerToString(ticket)+
               ",\"positionId\":"+IntegerToString(position_id)+",\"side\":\""+side+"\",\"volume\":"+DoubleToString(volume,2)+
               ",\"entry\":"+DoubleToString(entry,_Digits)+",\"stopLoss\":"+DoubleToString(stop,_Digits)+
               ",\"target1\":"+DoubleToString(tp1,_Digits)+",\"target2\":"+DoubleToString(tp2,_Digits)+
               ",\"target3\":"+DoubleToString(tp3,_Digits)+",\"target4\":"+DoubleToString(tp4,_Digits)+
               ",\"openedAt\":\""+TimeToString(TimeGMT(),TIME_DATE|TIME_SECONDS)+"\"}";
   HttpPostJson(ReportUrl,body);
}

void ReportTargets(const bool buy,const double current)
{
   if(!PositionSelect(g_symbol)) return;
   double t1=LoadValue("tp1"),t2=LoadValue("tp2"),t3=LoadValue("tp3"),t4=LoadValue("tp4");
   int old_mask=(int)LoadValue("target_mask",0.0),mask=old_mask;
   if(t1>0 && ((buy&&current>=t1)||(!buy&&current<=t1))) mask|=1;
   if(t2>0 && ((buy&&current>=t2)||(!buy&&current<=t2))) mask|=2;
   if(t3>0 && ((buy&&current>=t3)||(!buy&&current<=t3))) mask|=4;
   if(t4>0 && ((buy&&current>=t4)||(!buy&&current<=t4))) mask|=8;
   if(mask==old_mask) return;
   SaveValue("target_mask",(double)mask);
   long position_id=(long)PositionGetInteger(POSITION_IDENTIFIER);
   string body="{\"type\":\"UPDATE\",\"symbol\":\""+g_symbol+"\",\"positionId\":"+IntegerToString(position_id)+
               ",\"tp1Hit\":"+BoolText((mask&1)!=0)+",\"tp2Hit\":"+BoolText((mask&2)!=0)+
               ",\"tp3Hit\":"+BoolText((mask&4)!=0)+",\"tp4Hit\":"+BoolText((mask&8)!=0)+"}";
   HttpPostJson(ReportUrl,body);
}

void ManagePosition()
{
   if(!HasManagedPosition()) return;
   long type=PositionGetInteger(POSITION_TYPE);
   bool buy=type==POSITION_TYPE_BUY;
   double current=buy?SymbolInfoDouble(g_symbol,SYMBOL_BID):SymbolInfoDouble(g_symbol,SYMBOL_ASK);
   double open=PositionGetDouble(POSITION_PRICE_OPEN);
   double sl=PositionGetDouble(POSITION_SL);
   double tp=PositionGetDouble(POSITION_TP);
   double t1=LoadValue("tp1"),t2=LoadValue("tp2"),t3=LoadValue("tp3");
   ReportTargets(buy,current);
   if(t1<=0 || t2<=0 || t3<=0) return;
   double next_sl=sl;
   if((buy&&current>=t3)||(!buy&&current<=t3)) next_sl=t2;
   else if((buy&&current>=t2)||(!buy&&current<=t2)) next_sl=t1;
   else if((buy&&current>=t1)||(!buy&&current<=t1)) next_sl=open;
   bool improves=buy?(next_sl>sl+_Point):(sl==0.0 || next_sl<sl-_Point);
   if(improves && !trade.PositionModify(g_symbol,next_sl,tp))
      Print("Stop update failed: ",trade.ResultRetcodeDescription());
}

bool PriceInside(const double price,const double low,const double high){ return price>=MathMin(low,high)&&price<=MathMax(low,high); }

void ProcessSignal()
{
   ReportHeartbeat();
   ManagePosition();
   if(DailyLossLimitReached() || HasAnyPosition()) return;

   string json;
   if(!FetchSignal(json)) return;
   string status=JsonString(json,"status"),action=JsonString(json,"action"),side=JsonString(json,"side");
   long issued=(long)JsonNumber(json,"issuedAtMs",0.0),expires=(long)JsonNumber(json,"expiresAtMs",0.0);
   long now_ms=(long)TimeGMT()*1000;
   if(status!="ACTIVE" || action!=side || (side!="BUY"&&side!="SELL") || issued<=0 || expires<=now_ms) return;
   if((long)LoadValue("last_signal",0.0)==issued) return;

   MqlTick tick;
   if(!SymbolInfoTick(g_symbol,tick)) return;
   if(tick.ask-tick.bid>MaxSpreadPrice) return;

   double entry_low=JsonNumber(json,"entryLow"),entry_high=JsonNumber(json,"entryHigh");
   double stop=JsonNumber(json,"stopLoss"),tp1=JsonNumber(json,"target1"),tp2=JsonNumber(json,"target2"),tp3=JsonNumber(json,"target3"),tp4=JsonNumber(json,"target4");
   double price=side=="BUY"?tick.ask:tick.bid;
   bool live_account=AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_REAL;
   if(!EnableTrading || (live_account && !AllowLiveAccount))
   {
      Print("Validated signal observed only: ",side,"; trading remains disabled.");
      SaveValue("last_signal",(double)issued);
      return;
   }
   if(!TradingEnvironmentReady()){ Print("Trading blocked by MT5 terminal, EA settings, or account permissions."); return; }
   if(!PriceInside(price,entry_low,entry_high) || stop<=0 || tp4<=0) return;
   if((side=="BUY"&&(stop>=price||tp4<=price)) || (side=="SELL"&&(stop<=price||tp4>=price))) return;

   double volume=RiskVolume(price,stop);
   if(volume<=0.0){ Print("Trade skipped: minimum lot exceeds risk cap."); return; }

   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetDeviationInPoints(DeviationPoints);
   bool sent=side=="BUY"?trade.Buy(volume,g_symbol,0.0,stop,tp4,"Gold Alpha Auto")
                        :trade.Sell(volume,g_symbol,0.0,stop,tp4,"Gold Alpha Auto");
   if(!sent){ Print("Order failed: ",trade.ResultRetcodeDescription()); return; }

   SaveValue("last_signal",(double)issued);
   SaveValue("tp1",tp1); SaveValue("tp2",tp2); SaveValue("tp3",tp3); SaveValue("tp4",tp4); SaveValue("target_mask",0.0);
   ReportOpen(side,volume,stop,tp1,tp2,tp3,tp4);
   Print("Opened ",side," ",DoubleToString(volume,2)," lots on ",g_symbol);
}

string CloseReasonText(const long reason)
{
   if(reason==DEAL_REASON_TP) return "TP";
   if(reason==DEAL_REASON_SL) return "SL";
   if(reason==DEAL_REASON_CLIENT) return "CLIENT";
   if(reason==DEAL_REASON_EXPERT) return "EXPERT";
   return "OTHER";
}

bool IsGoldSymbol(const string symbol)
{
   string s=symbol;
   StringToUpper(s);
   return StringFind(s,"XAU")>=0 || StringFind(s,"GOLD")>=0;
}

bool IsJustMarketsBroker()
{
   string company=AccountInfoString(ACCOUNT_COMPANY);
   string server=AccountInfoString(ACCOUNT_SERVER);
   StringToUpper(company);
   StringToUpper(server);
   return StringFind(company,"JUSTMARKETS")>=0 || StringFind(company,"JUST GLOBAL")>=0 ||
          StringFind(server,"JUSTMARKETS")>=0 || StringFind(server,"JUST GLOBAL")>=0;
}

bool TradingEnvironmentReady()
{
   return (bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) &&
          (bool)MQLInfoInteger(MQL_TRADE_ALLOWED) &&
          (bool)AccountInfoInteger(ACCOUNT_TRADE_ALLOWED);
}

void OnTradeTransaction(const MqlTradeTransaction &trans,const MqlTradeRequest &request,const MqlTradeResult &result)
{
   if(trans.type!=TRADE_TRANSACTION_DEAL_ADD || trans.deal==0) return;
   if(!HistoryDealSelect(trans.deal)) return;
   if((ulong)HistoryDealGetInteger(trans.deal,DEAL_MAGIC)!=MagicNumber) return;
   if(HistoryDealGetString(trans.deal,DEAL_SYMBOL)!=g_symbol) return;
   long entry_type=HistoryDealGetInteger(trans.deal,DEAL_ENTRY);
   if(entry_type!=DEAL_ENTRY_OUT && entry_type!=DEAL_ENTRY_OUT_BY) return;

   long position_id=HistoryDealGetInteger(trans.deal,DEAL_POSITION_ID);
   double profit=HistoryDealGetDouble(trans.deal,DEAL_PROFIT)+HistoryDealGetDouble(trans.deal,DEAL_COMMISSION)+HistoryDealGetDouble(trans.deal,DEAL_SWAP);
   double close_price=HistoryDealGetDouble(trans.deal,DEAL_PRICE);
   long reason=HistoryDealGetInteger(trans.deal,DEAL_REASON);
   int mask=(int)LoadValue("target_mask",0.0);
   string body="{\"type\":\"CLOSE\",\"symbol\":\""+g_symbol+"\",\"positionId\":"+IntegerToString(position_id)+
               ",\"closePrice\":"+DoubleToString(close_price,_Digits)+",\"profit\":"+DoubleToString(profit,2)+
               ",\"closeReason\":\""+CloseReasonText(reason)+"\",\"tp1Hit\":"+BoolText((mask&1)!=0)+
               ",\"tp2Hit\":"+BoolText((mask&2)!=0)+",\"tp3Hit\":"+BoolText((mask&4)!=0)+
               ",\"tp4Hit\":"+BoolText((mask&8)!=0)+",\"closedAt\":\""+TimeToString(TimeGMT(),TIME_DATE|TIME_SECONDS)+"\"}";
   HttpPostJson(ReportUrl,body);
}

int OnInit()
{
   g_symbol=TradeSymbol==""?_Symbol:TradeSymbol;
   if(RequireGoldSymbol && !IsGoldSymbol(g_symbol)){ Print("Attach this EA to the JustMarkets gold chart only. Current symbol: ",g_symbol); return INIT_FAILED; }
   if(RequireJustMarkets && !IsJustMarketsBroker()){ Print("JustMarkets account/server not detected. Company: ",AccountInfoString(ACCOUNT_COMPANY)," Server: ",AccountInfoString(ACCOUNT_SERVER)); return INIT_FAILED; }
   bool live_account=AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_REAL;
   if(live_account && !AllowLiveAccount) Print("Live account detected: observation only unless AllowLiveAccount=true.");
   if(!SymbolSelect(g_symbol,true)) return INIT_FAILED;
   if(SymbolInfoInteger(g_symbol,SYMBOL_TRADE_MODE)==SYMBOL_TRADE_MODE_DISABLED){ Print("Trading is disabled for ",g_symbol); return INIT_FAILED; }
   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetDeviationInPoints(DeviationPoints);
   trade.SetTypeFillingBySymbol(g_symbol);
   g_prefix="GOLDAP_"+(string)AccountInfoInteger(ACCOUNT_LOGIN)+"_"+g_symbol+"_";
   g_day_start=(datetime)LoadValue("day",0.0);
   g_day_start_equity=LoadValue("day_equity",0.0);
   RefreshDailyEquity();
   EventSetTimer(MathMax(PollSeconds,1));
   ReportHeartbeat();
   Print("GoldAlpha JustMarkets v2.10 active on ",g_symbol," (trading: ",EnableTrading,", live allowed: ",AllowLiveAccount,")");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason){ EventKillTimer(); }
void OnTimer(){ ProcessSignal(); }
void OnTick(){ ManagePosition(); }
