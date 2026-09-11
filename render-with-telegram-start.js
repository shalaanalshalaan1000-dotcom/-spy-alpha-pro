import { spawn } from 'node:child_process';

const main = spawn(process.execPath, ['gold-resilient-unified-start.js'], {
  env: { ...process.env },
  stdio: ['ignore', 'inherit', 'inherit']
});

const telegram = spawn(process.execPath, ['telegram-xau-bot.js'], {
  env: {
    ...process.env,
    TELEGRAM_SIGNAL_URL: process.env.TELEGRAM_SIGNAL_URL || 'http://127.0.0.1:3002/api/auto-trade/signal?observe=1'
  },
  stdio: ['ignore', 'inherit', 'inherit']
});

main.on('exit', code => {
  console.error('[render-start] main exited', code);
  if (!telegram.killed) telegram.kill('SIGTERM');
  process.exit(code ?? 1);
});

telegram.on('exit', code => {
  console.error('[render-start] telegram bot exited', code);
});

function shutdown(signal) {
  if (!main.killed) main.kill(signal);
  if (!telegram.killed) telegram.kill(signal);
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
