import test from 'node:test';
import assert from 'node:assert/strict';
import { activeSignal, levelsReady, signalMessage } from '../telegram-xau-bot.js';

const levels = {
  candidateAction:'BUY',
  entryLow:4312,
  entryHigh:4313,
  stopLoss:4310,
  target1:4314,
  target2:4315,
  target3:4316,
  target4:4317
};

test('WAIT and pre-entry CONFIRMED readings are not Telegram trade signals', () => {
  assert.equal(activeSignal({...levels,status:'WAIT'}), false);
  assert.equal(activeSignal({...levels,status:'CONFIRMED'}), false);
  assert.equal(activeSignal({...levels,status:'ACTIVE'}), false);
});

test('only a lifecycle signal with a signalId is confirmed', () => {
  const signal = {...levels,signalId:'XAU-1-BUY',status:'ACTIVE',price:4312.5,confidence:90};
  assert.equal(activeSignal(signal), true);
  assert.equal(levelsReady(signal), true);
  const message = signalMessage(signal);
  assert.match(message,/CONFIRMED BUY ENTRY/);
  assert.match(message,/XAU-1-BUY/);
  assert.doesNotMatch(message,/EARLY|SETUP ARMED|ليست دخول/);
});

test('MANAGING remains linked to the same confirmed lifecycle signal', () => {
  assert.equal(activeSignal({...levels,signalId:'XAU-1-BUY',status:'MANAGING'}), true);
});
