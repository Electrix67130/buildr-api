FROM node:24-alpine AS base
WORKDIR /usr/src/app
COPY package*.json ./

FROM base AS development
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM base AS production
# npm ci complet (pas --only=production) : l'app tourne via tsx, qui est en
# devDependencies. Acceptable pour la beta ; a compiler (tsc) plus tard.
RUN npm ci
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
