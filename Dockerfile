FROM node:22-alpine
WORKDIR /app
COPY package.json server.js start.js gold-start.js gold-terminal-start.js gold-server-start.js gold-paper-start.js ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm","start"]
