FROM node:20.5.1-alpine

ENV NODE_ENV=production

#INSTALL NECESSARY PACKAGES
RUN apk add --no-cache ttf-dejavu

#INSTALL NECESSARY PACKAGES FOR CHROME
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont

# Working directory for the app
WORKDIR /chatbot

COPY package*.json ./

# Installing dependencies
RUN npm install --omit=dev

# copy local files to app folder
COPY . .

#SET ENVIRONMENT VARIABLE FOR PUPPETEER'S CHROME EXECUTABLE PATH
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

EXPOSE 7000

CMD ["node", "/chatbot/bin/www_prod.js"]