#property strict
#property version   "1.00"
#property description "One-shot demo-only trade test for Gold Alpha / JustMarkets"

#include <Trade/Trade.mqh>

input bool   RunTestTrade      = false;
input bool   TestBuy           = true;
input int    StopPoints        = 300;
input int    TargetPoints      = 600;
input ulong  MagicNumber       = 26091101;

CTrade trade;
bool g_done=false;

bool IsGoldSymbol(const string symbol)
{
   string s=symbol;
   StringToUpper(s);
   return StringFind(s,"XAU")>=0 || StringFind(s,"GOLD")>=0;
}

int OnInit()
{
   if(!IsGoldSymbol(_Symbol))
   {
      Print("TEST BLOCKED: attach to XAUUSD/GOLD chart only.");
      return INIT_FAILED;
   }
   if(AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_DEMO)
   {
      Print("TEST BLOCKED: this EA only trades on DEMO accounts.");
      return INIT_FAILED;
   }
   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetTypeFillingBySymbol(_Symbol);
   EventSetTimer(1);
   Print("Demo test EA loaded. Set RunTestTrade=true to send exactly one minimum-lot test order.");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   if(g_done || !RunTestTrade) return;
   g_done=true;

   if(!(bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) ||
      !(bool)MQLInfoInteger(MQL_TRADE_ALLOWED) ||
      !(bool)AccountInfoInteger(ACCOUNT_TRADE_ALLOWED))
   {
      Print("TEST FAILED: Algo Trading/account permissions are disabled.");
      return;
   }

   MqlTick tick;
   if(!SymbolInfoTick(_Symbol,tick))
   {
      Print("TEST FAILED: no market tick available.");
      return;
   }

   double volume=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);
   double step=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
   if(volume<=0 || step<=0)
   {
      Print("TEST FAILED: invalid broker volume settings.");
      return;
   }

   int digits=(int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS);
   double point=SymbolInfoDouble(_Symbol,SYMBOL_POINT);
   double entry=TestBuy?tick.ask:tick.bid;
   double sl=TestBuy?entry-StopPoints*point:entry+StopPoints*point;
   double tp=TestBuy?entry+TargetPoints*point:entry-TargetPoints*point;
   sl=NormalizeDouble(sl,digits);
   tp=NormalizeDouble(tp,digits);

   bool ok=TestBuy
      ? trade.Buy(volume,_Symbol,0.0,sl,tp,"GoldAlpha DEMO TEST")
      : trade.Sell(volume,_Symbol,0.0,sl,tp,"GoldAlpha DEMO TEST");

   if(ok)
      Print("TEST ORDER OPENED: ",(TestBuy?"BUY":"SELL")," ",DoubleToString(volume,2)," lots; SL=",DoubleToString(sl,digits)," TP=",DoubleToString(tp,digits));
   else
      Print("TEST ORDER FAILED: ",trade.ResultRetcode()," ",trade.ResultRetcodeDescription());
}
