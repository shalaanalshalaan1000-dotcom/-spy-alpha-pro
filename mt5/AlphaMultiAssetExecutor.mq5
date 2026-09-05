#property strict
#property version   "1.00"
#property description "XAUUSD/BTCUSD executor for SPY Alpha Pro on MT5"

#include <Trade/Trade.mqh>

input string SignalUrl            = "https://spy-alpha-pro-1.onrender.com/api/auto-trade/signal";
input string TradeSymbol          = "";        // Blank: use the chart symbol.
input bool   EnableTrading        = false;     // Set true only after checking the chart symbol and Experts log.
input bool   AllowLiveAccount     = false;     // Must also be true for a real account.
input double RiskPercent          = 2.00;      // User-selected maximum equity risk per trade.
input double MaxDailyLossPercent  = 10.00;     // Shared account stop for this EA's instances.
input double MaxSpreadPrice       = 0.00;      // 0: automatic (gold 0.80; crypto 0.05% of price).
input int    PollSeconds          = 5;
input int    RequestTimeoutMs     = 15000;
input int    DeviationPoints      = 30;
input ulong  MagicNumber          = 26090501;

CTrade trade;
string g_symbol;
string g_signal_url;
string g_symbol_prefix;
string g_account_prefix;
datetime g_day_start;
double g_day_start_equity = 0.0;

string AccountKey(const string suffix) { return g_account_prefix + suffix; }
string SymbolKey(const string suffix) { return g_symbol_prefix + suffix; }
void SaveSymbolValue(const string name,const double value){GlobalVariableSet(SymbolKey(name),value);}
double LoadSymbolValue(const string name,const double fallback=0.0){return GlobalVariableCheck(SymbolKey(name))?GlobalVariableGet(SymbolKey(name)):fallback;}

string JsonString(const string json,const string key){string token="\""+key+"\"";int p=StringFind(json,token);if(p<0)return"";p=StringFind(json,":",p+StringLen(token));if(p<0)return"";int q1=StringFind(json,"\"",p+1);if(q1<0)return"";int q2=q1+1;while(q2<StringLen(json)){if(StringSubstr(json,q2,1)=="\""&&StringSubstr(json,q2-1,1)!="\\")break;q2++;}if(q2>=StringLen(json))return"";return StringSubstr(json,q1+1,q2-q1-1);}
double JsonNumber(const string json,const string key,const double fallback=0.0){string token="\""+key+"\"";int p=StringFind(json,token);if(p<0)return fallback;p=StringFind(json,":",p+StringLen(token));if(p<0)return fallback;p++;while(p<StringLen(json)&&(StringSubstr(json,p,1)==" "||StringSubstr(json,p,1)=="\t"))p++;int e=p;while(e<StringLen(json)){string c=StringSubstr(json,e,1);if(StringFind("-+.0123456789eE",c)<0)break;e++;}if(e<=p)return fallback;return StringToDouble(StringSubstr(json,p,e-p));}

bool FetchSignal(string &json){char payload[],response[];string headers;ResetLastError();int status=WebRequest("GET",g_signal_url,"Accept: application/json\r\n",RequestTimeoutMs,payload,response,headers);if(status==-1){Print("Signal request failed (",GetLastError(),"). Allow WebRequest for https://spy-alpha-pro-1.onrender.com");return false;}if(status!=200){Print("Signal endpoint returned HTTP ",status);return false;}json=CharArrayToString(response,0,-1,CP_UTF8);return true;}

datetime StartOfServerDay(){MqlDateTime now;TimeToStruct(TimeTradeServer(),now);now.hour=0;now.min=0;now.sec=0;return StructToTime(now);}
void RefreshDailyEquity(){datetime today=StartOfServerDay();double stored_day=GlobalVariableCheck(AccountKey("day"))?GlobalVariableGet(AccountKey("day")):0.0;if(today!=(datetime)stored_day){g_day_start=today;g_day_start_equity=AccountInfoDouble(ACCOUNT_EQUITY);GlobalVariableSet(AccountKey("day"),(double)today);GlobalVariableSet(AccountKey("day_equity"),g_day_start_equity);}else{g_day_start=(datetime)stored_day;g_day_start_equity=GlobalVariableCheck(AccountKey("day_equity"))?GlobalVariableGet(AccountKey("day_equity")):AccountInfoDouble(ACCOUNT_EQUITY);}}
bool DailyLossLimitReached(){RefreshDailyEquity();if(g_day_start_equity<=0.0)return true;double loss=100.0*(g_day_start_equity-AccountInfoDouble(ACCOUNT_EQUITY))/g_day_start_equity;return loss>=MaxDailyLossPercent;}

int VolumeDigits(const double step){int digits=0;double scaled=step;while(digits<8&&MathAbs(scaled-MathRound(scaled))>1e-8){scaled*=10.0;digits++;}return digits;}
double RiskVolume(const double entry,const double stop){double distance=MathAbs(entry-stop),tick_size=SymbolInfoDouble(g_symbol,SYMBOL_TRADE_TICK_SIZE),tick_value=SymbolInfoDouble(g_symbol,SYMBOL_TRADE_TICK_VALUE_LOSS),step=SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_STEP),minimum=SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_MIN),maximum=SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_MAX);if(distance<=0.0||tick_size<=0.0||tick_value<=0.0||step<=0.0)return 0.0;double risk_cash=AccountInfoDouble(ACCOUNT_EQUITY)*RiskPercent/100.0,cash_per_lot=(distance/tick_size)*tick_value,raw=risk_cash/cash_per_lot,volume=MathFloor(raw/step)*step;if(volume+1e-9<minimum)return 0.0;volume=MathMin(volume,maximum);return NormalizeDouble(volume,VolumeDigits(step));}

bool HasManagedPositionOnSymbol(){if(!PositionSelect(g_symbol))return false;return(ulong)PositionGetInteger(POSITION_MAGIC)==MagicNumber;}
bool HasAnyPositionOnSymbol(){return PositionSelect(g_symbol);}

void ManagePosition(){if(!HasManagedPositionOnSymbol())return;long type=PositionGetInteger(POSITION_TYPE);double current=type==POSITION_TYPE_BUY?SymbolInfoDouble(g_symbol,SYMBOL_BID):SymbolInfoDouble(g_symbol,SYMBOL_ASK),open=PositionGetDouble(POSITION_PRICE_OPEN),sl=PositionGetDouble(POSITION_SL),tp=PositionGetDouble(POSITION_TP),t1=LoadSymbolValue("tp1"),t2=LoadSymbolValue("tp2"),t3=LoadSymbolValue("tp3");if(t1<=0||t2<=0||t3<=0)return;double next_sl=sl;bool buy=type==POSITION_TYPE_BUY;if((buy&&current>=t3)||(!buy&&current<=t3))next_sl=t2;else if((buy&&current>=t2)||(!buy&&current<=t2))next_sl=t1;else if((buy&&current>=t1)||(!buy&&current<=t1))next_sl=open;bool improves=buy?(next_sl>sl+SymbolInfoDouble(g_symbol,SYMBOL_POINT)):(sl==0.0||next_sl<sl-SymbolInfoDouble(g_symbol,SYMBOL_POINT));if(improves&&!trade.PositionModify(g_symbol,next_sl,tp))Print("Stop update failed: ",trade.ResultRetcodeDescription());}

double AllowedSpread(const double price){if(MaxSpreadPrice>0.0)return MaxSpreadPrice;string upper=g_symbol;StringToUpper(upper);return StringFind(upper,"BTC")>=0?price*0.0005:0.80;}
double ShiftLevel(const double source_entry,const double source_level,const double broker_entry,const bool buy){double distance=MathAbs(source_level-source_entry);return buy?broker_entry+distance:broker_entry-distance;}

void ProcessSignal(){ManagePosition();if(DailyLossLimitReached()||HasAnyPositionOnSymbol())return;string json;if(!FetchSignal(json))return;string status=JsonString(json,"status"),action=JsonString(json,"action"),side=JsonString(json,"side");long issued=(long)JsonNumber(json,"issuedAtMs",0.0),expires=(long)JsonNumber(json,"expiresAtMs",0.0),now_ms=(long)TimeGMT()*1000;if(status!="ACTIVE"||action!=side||(side!="BUY"&&side!="SELL")||issued<=0||expires<=now_ms)return;if((long)LoadSymbolValue("last_signal",0.0)==issued)return;MqlTick tick;if(!SymbolInfoTick(g_symbol,tick))return;double broker_entry=side=="BUY"?tick.ask:tick.bid;if(tick.ask-tick.bid>AllowedSpread(broker_entry)){Print("Trade skipped: spread exceeds configured limit.");return;}double source_entry=JsonNumber(json,"entry"),source_stop=JsonNumber(json,"stopLoss"),source_t1=JsonNumber(json,"target1"),source_t2=JsonNumber(json,"target2"),source_t3=JsonNumber(json,"target3"),source_t4=JsonNumber(json,"target4");bool buy=side=="BUY",live_account=AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_REAL;if(!EnableTrading||(live_account&&!AllowLiveAccount)){Print("Validated ",side," signal observed only; trading remains disabled.");SaveSymbolValue("last_signal",(double)issued);return;}if(source_entry<=0||source_stop<=0||source_t4<=0||(buy&&(source_stop>=source_entry||source_t4<=source_entry))||(!buy&&(source_stop<=source_entry||source_t4>=source_entry)))return;double stop=ShiftLevel(source_entry,source_stop,broker_entry,!buy),tp1=ShiftLevel(source_entry,source_t1,broker_entry,buy),tp2=ShiftLevel(source_entry,source_t2,broker_entry,buy),tp3=ShiftLevel(source_entry,source_t3,broker_entry,buy),tp4=ShiftLevel(source_entry,source_t4,broker_entry,buy),volume=RiskVolume(broker_entry,stop);if(volume<=0.0){Print("Trade skipped: broker minimum lot would exceed configured risk.");return;}trade.SetExpertMagicNumber(MagicNumber);trade.SetDeviationInPoints(DeviationPoints);bool sent=buy?trade.Buy(volume,g_symbol,0.0,stop,tp4,"SPY Alpha"):trade.Sell(volume,g_symbol,0.0,stop,tp4,"SPY Alpha");if(!sent){Print("Order failed: ",trade.ResultRetcodeDescription());return;}SaveSymbolValue("last_signal",(double)issued);SaveSymbolValue("tp1",tp1);SaveSymbolValue("tp2",tp2);SaveSymbolValue("tp3",tp3);SaveSymbolValue("tp4",tp4);Print("Opened ",side," ",DoubleToString(volume,VolumeDigits(SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_STEP)))," lots on ",g_symbol);}

int OnInit(){g_symbol=TradeSymbol==""?_Symbol:TradeSymbol;string upper=g_symbol;StringToUpper(upper);string asset=StringFind(upper,"BTC")>=0?"BTCUSD":"XAUUSD";g_signal_url=SignalUrl+(StringFind(SignalUrl,"?")>=0?"&":"?")+"asset="+asset;bool live_account=AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_REAL;if(live_account&&!AllowLiveAccount)Print("Live account detected: observation mode only.");if(!SymbolSelect(g_symbol,true))return INIT_FAILED;g_account_prefix="SPYAP_"+(string)AccountInfoInteger(ACCOUNT_LOGIN)+"_";g_symbol_prefix=g_account_prefix+g_symbol+"_";RefreshDailyEquity();EventSetTimer(MathMax(PollSeconds,1));Print("AlphaMultiAssetExecutor active on ",g_symbol," using ",asset," signals (trading: ",EnableTrading,", live allowed: ",AllowLiveAccount,")");return INIT_SUCCEEDED;}
void OnDeinit(const int reason){EventKillTimer();}
void OnTimer(){ProcessSignal();}
void OnTick(){ManagePosition();}
