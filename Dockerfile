FROM node:20-alpine
WORKDIR /app
COPY package.json server.js index.html styles.css app.js extractor.js ./
ENV HOST=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
