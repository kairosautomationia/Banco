FROM node:20-alpine
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
ENV HOST=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
