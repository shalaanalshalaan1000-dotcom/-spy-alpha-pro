FROM node:22-alpine
WORKDIR /app
COPY package.json server.js *.js ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node","render-gold-start.js"]
