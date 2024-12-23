FROM node:20.5.1-alpine

ENV NODE_ENV=production

#INSTALL NECESSARY PACKAGES
RUN apk add --no-cache ttf-dejavu

# Working directory for the app
WORKDIR /chatbot

COPY package*.json ./

# Installing dependencies
RUN npm install --omit=dev

# copy local files to app folder
COPY . .

EXPOSE 7000

CMD ["node", "/chatbot/bin/www_prod.js"]