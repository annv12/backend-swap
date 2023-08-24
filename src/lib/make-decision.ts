import { BetType, ExchangePair, PrismaClient } from '@prisma/client'
import BigNumber from 'bignumber.js'
import { WSTrade } from 'binance-api-node'
import { ExcOrder } from '../services/set-real-binance-price'
import Redis from 'ioredis'
import { RedisDatabaseKey } from './redis-utils'
import fs from 'fs'
// import { publishPlatformBalanceSignal } from './platform-util'
const PATH_USER_FAKE = 'user_fake.json'
const userFakes: {
  email: string
  username: string
}[] = fs.existsSync(PATH_USER_FAKE)
  ? JSON.parse(fs.readFileSync(PATH_USER_FAKE).toString())
  : []
const userIds = userFakes.map((user) => user.username)
export type Decision = 'UP' | 'DOWN' | 'BALANCE'

export enum TradeMode {
  NATURE = 'NATURE',
  AUTO_BALANCE = 'AUTO_BALANCE',
  AUTO_GAIN = 'AUTO_GAIN',
  AUTO_LOSS = 'AUTO_LOSS',
  NATURE_PLUS = 'NATURE_PLUS',
}

const DEFAULT_TRADE_MODE = TradeMode.AUTO_GAIN

export async function cleanupDecision(
  redis: Redis,
  exchangePair: ExchangePair,
) {
  return await Promise.all([
    redis.del(RedisDatabaseKey.ROUND_DECISION),
    redis.del(RedisDatabaseKey.ROUND_DECISION + '.' + exchangePair.name),
  ])
}

function randomFromrange(min: number, max: number) {
  return Math.random() * (max - min + 1) + min
}

function randomFromRangeWithStep(min, max, step = 0.0001) {
  max = Math.max(max, 0.0015)
  return Math.floor((Math.random() * (max - min)) / step) * step + min
}
