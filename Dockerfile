FROM node:22-alpine
WORKDIR /app
COPY package.json server.js start.js gold-start.js gold-terminal-start.js gold-server-start.js gold-paper-start.js gold-telegram-start.js gold-ict-start.js gold-only-stable-start.js gold-ict-levels-start.js gold-ict-history-start.js gold-ui-clean-start.js gold-ict-first-start.js gold-btc-ict-start.js gold-fix-start.js gold-live-start.js justmarkets-start.js multi-asset-start.js ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node","multi-asset-start.js"]
