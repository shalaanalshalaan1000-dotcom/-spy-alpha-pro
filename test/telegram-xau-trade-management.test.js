import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV='test';
const {tradeManagementMessage}=await import('../telegram-xau-bot-v2.js');

function signal(action, overrides={}) {
  return {
    signalId:'XAU-MGMT-1',
    side:'SELL',
    price:4169.25,
    agentStack:{
      agents:{
        tradeManager:{
          managementDecision:{
            action,
            confirmed:true,
            confidence:88,
            modelSide:action==='STOP'?'BUY':'SELL',
            reason:action==='STOP'
              ? 'Confirmed opposite BUY model at 88%.'
              : 'Confirmed SELL model remains aligned at 88%.',
            ...overrides
          }
        }
      }
    }
  };
}

test('Telegram formats a confirmed CONTINUE trade-management decision', () => {
  const message=tradeManagementMessage(signal('CONTINUE'));
  assert.match(message,/CONTINUE TRADE/);
  assert.match(message,/استمر في صفقة SELL/);
  assert.match(message,/88%/);
});

test('Telegram formats a confirmed STOP trade-management decision as exit advice, not reverse entry', () => {
  const message=tradeManagementMessage(signal('STOP'));
  assert.match(message,/STOP \/ EXIT TRADE/);
  assert.match(message,/اخرج من صفقة SELL/);
  assert.match(message,/ليس إشارة دخول عكسية/);
});

test('Telegram ignores unconfirmed management candidates', () => {
  const message=tradeManagementMessage(signal('STOP',{confirmed:false}));
  assert.equal(message,null);
});
