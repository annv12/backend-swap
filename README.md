# BOBE

## Requirement
- nodejs
- npm
- postgrestql
- redis

## How to use
```bash
npm install

cp .env.dev .env

npm run dev
```
## Generate prisma client & nexus
```bash
npm run generate
# Seprated command
npm run generate:prisma
npm run generate:nexus
```
## Migration
```bash
npm run migrate:save
npm run migrate:up
```
## Deploy
* Deploy to `dev` server: push to `develop` branch
* Deploy to `staging` a.k.a `stg` server: merge branch `develop` to `master`
### What happen when deploy ?
Look inside the `.drone.yml` file
