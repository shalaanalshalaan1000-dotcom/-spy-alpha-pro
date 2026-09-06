FROM node:22-alpine
WORKDIR /app
COPY package.json gold-app.js ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node","gold-app.js"]
