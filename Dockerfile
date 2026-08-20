FROM node:22-alpine
WORKDIR /app
COPY package.json server.js start.js focus-start.js wide-start.js ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm","start"]
