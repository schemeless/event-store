FROM node:12.16.2
WORKDIR /srv

RUN apk --update add imagemagick

COPY ./package.json .
COPY ./package-lock.json .
COPY ./node_modules ./node_modules
COPY ./dist ./dist

EXPOSE 4000
CMD ["npm", "run", "prod:start"]
