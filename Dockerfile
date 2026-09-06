FROM node:22-alpine
WORKDIR /app
COPY package.json server.js gold-complete-start.js ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node","gold-complete-start.js"]
