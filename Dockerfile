FROM node:22-alpine
WORKDIR /app
COPY package.json server.js gold-only-stable-start.js gold-news-start.js ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node","gold-news-start.js"]
