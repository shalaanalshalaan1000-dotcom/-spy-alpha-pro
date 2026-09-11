#property strict
#property version   "1.00"
#property description "Gold Alpha Pro - DEMO verification EA. Opens tiny test trades periodically to prove 24/7 runtime. Refuses REAL accounts."

#include <Trade/Trade.mqh>

input string TradeSymbol          = "";
input bool   EnableTestTrading     = true;
input int    TestIntervalMinutes   = 30;
input int    HoldSeconds           = 120;
input double StopDistancePrice     = 3.00;
input double TakeProfitDistance    = 3.00;
input int    DeviationPoints       = 50;
input ulong  MagicNumber           = 26091101;

CTrade trade;
string g_symbol;
datetime g_last_open_time=0;
datetime g_position_open_time=0;
bool g_next_buy=true;

bool IsGoldSymbol(const string symbol)
{
   string s=symbol;
   StringToUpper(s);
   return StringFind(s,"XAU")>=0 || StringFind(s,"GOLD")>=0;
}

bool TradingReady()
{
   return (bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) &&
          (bool)MQLInfoInteger(MQL_TRADE_ALLOWED) &&
          (bool)AccountInfoInteger(ACCOUNT_TRADE_ALLOWED);
}

bool MarketOpen()
{
   MqlTick tick;
   if(!SymbolInfoTick(g_symbol,tick)) return false;
   if(tick.bid<=0 || tick.ask<=0) return false;
   long mode=SymbolInfoInteger(g_symbol,SYMBOL_TRADE_MODE);
   return mode!=SYMBOL_TRADE_MODE_DISABLED && mode!=SYMBOL_TRADE_MODE_CLOSEONLY;
}

double MinLot()
{
   double v=SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_MIN);
   double step=SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_STEP);
   if(v<=0 || step<=0) return 0.0;
   return MathMax(v,step);
}

bool HasOurPosition()
{
   if(!PositionSelect(g_symbol)) return false;
   return (ulong)PositionGetInteger(POSITION_MAGIC)==MagicNumber;
}

void CloseExpiredPosition()
{
   if(!HasOurPosition()) return;
   if(g_position_open_time==0)
      g_position_open_time=(datetime)PositionGetInteger(POSITION_TIME);
   if(TimeCurrent()-g_position_open_time < HoldSeconds) return;

   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetDeviationInPoints(DeviationPoints);
   trade.SetTypeFillingBySymbol(g_symbol);

   if(trade.PositionClose(g_symbol))
   {
      Print("VERIFY: test position closed after ",HoldSeconds," seconds.");
      g_position_open_time=0;
   }
   else
      Print("VERIFY: close failed: ",trade.ResultRetcodeDescription());
}

void TryOpenTestTrade()
{
   if(!EnableTestTrading) return;
   if(HasOurPosition()) return;
   if(!TradingReady() || !MarketOpen()) return;

   datetime now=TimeCurrent();
   if(g_last_open_time>0 && now-g_last_open_time < TestIntervalMinutes*60) return;

   MqlTick tick;
   if(!SymbolInfoTick(g_symbol,tick)) return;

   double lot=MinLot();
   if(lot<=0) return;

   int digits=(int)SymbolInfoInteger(g_symbol,SYMBOL_DIGITS);
   double price=g_next_buy?tick.ask:tick.bid;
   double sl=g_next_buy?price-StopDistancePrice:price+StopDistancePrice;
   double tp=g_next_buy?price+TakeProfitDistance:price-TakeProfitDistance;
   sl=NormalizeDouble(sl,digits);
   tp=NormalizeDouble(tp,digits);

   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetDeviationInPoints(DeviationPoints);
   trade.SetTypeFillingBySymbol(g_symbol);

   bool sent=g_next_buy ? trade.Buy(lot,g_symbol,0.0,sl,tp,"VERIFY DEMO")
                        : trade.Sell(lot,g_symbol,0.0,sl,tp,"VERIFY DEMO");

   if(sent)
   {
      g_last_open_time=now;
      g_position_open_time=now;
      Print("VERIFY OPEN: ",(g_next_buy?"BUY ":"SELL "),DoubleToString(lot,2)," on ",g_symbol,
            ". Next test after ",TestIntervalMinutes," min.");
      g_next_buy=!g_next_buy;
   }
   else
      Print("VERIFY: order failed: ",trade.ResultRetcodeDescription());
}

int OnInit()
{
   g_symbol=(TradeSymbol=="")?_Symbol:TradeSymbol;

   if(AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_REAL)
   {
      Print("VERIFY EA REFUSED: real account detected. Use a DEMO account for forced test trades.");
      return INIT_FAILED;
   }
   if(!IsGoldSymbol(g_symbol))
   {
      Print("VERIFY EA: attach to a gold/XAU chart. Current symbol: ",g_symbol);
      return INIT_FAILED;
   }
   if(!SymbolSelect(g_symbol,true)) return INIT_FAILED;

   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetDeviationInPoints(DeviationPoints);
   trade.SetTypeFillingBySymbol(g_symbol);
   EventSetTimer(1);

   Print("GoldAlpha VERIFY DEMO active on ",g_symbol,
         ". Test trade every ",TestIntervalMinutes," min; hold ",HoldSeconds," sec. REAL accounts are blocked.");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason){ EventKillTimer(); }
void OnTimer(){ CloseExpiredPosition(); TryOpenTestTrade(); }
void OnTick(){ CloseExpiredPosition(); }
