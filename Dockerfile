FROM mhart/alpine-node:16.4.2
RUN apk add --update --no-cache \
  make \
  g++ \
  jpeg-dev \
  cairo-dev \
  giflib-dev \
  pango-dev \
  libtool \
  autoconf \
  automake \
  fontconfig
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install

ARG BUILD_ENV

COPY . .
COPY .env.${BUILD_ENV:-dev} ./.env
RUN npm run compile
RUN npm run generate:prisma
# RUN npm run build
EXPOSE 4000
EXPOSE 4001
# CMD [ "npm", "start" ]
