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
const userIds = userFakes.map(user => user.username)
export type Decision = 'UP' | 'DOWN' | 'BALANCE'

export enum TradeMode {
  NATURE = 'NATURE',
  AUTO_BALANCE = 'AUTO_BALANCE',
  AUTO_GAIN = 'AUTO_GAIN',
  AUTO_LOSS = 'AUTO_LOSS',
  NATURE_PLUS = 'NATURE_PLUS',
}

const DEFAULT_TRADE_MODE = TradeMode.AUTO_GAIN

export async function makeDecision(
  order: ExcOrder,
  binaceOrder: WSTrade,
  prisma: PrismaClient,
  openPrice: string,
  redis: Redis,
  countDown: number,
  publisher: Redis,
  exchangePair: ExchangePair,
) {
  const [
    totalUpVolume,
    totalDownVolume,
    totalBetAmount,
    totalWinAmount,
    redisDecisionOld,
    redisDecision,
    redisTradeMode,
    // platformBalance,
    totalInSurance,
    totalCut,
  ] = await Promise.all([
    prisma.order.aggregate({
      where: {
        round_id: order.round - 1,
        bet_type: BetType.UP,
        exchange_pair_id: exchangePair.id,
        NOT: {
          User: {
            username: {
              in: userIds
            }
          }
        },
      },
      _sum: {
        bet_amount: true,
      },
    }),
    prisma.order.aggregate({
      where: {
        round_id: order.round - 1,
        bet_type: BetType.DOWN,
        exchange_pair_id: exchangePair.id,
        NOT: {
          User: {
            username: {
              in: userIds
            }
          }
        },
      },
      _sum: {
        bet_amount: true,
      },
    }),
    prisma.order.aggregate({
      where: {
        NOT: {
          User: {
            username: {
              in: userIds
            }
          }
        },
      },
      _sum: {
        bet_amount: true,
      },
    }),
    prisma.orderResult.aggregate({
      where: {
        NOT: {
          User: {
            username: {
              in: userIds
            }
          }
        },
      },
      _sum: {
        win_amount: true,
      },
    }),
    redis.get(RedisDatabaseKey.ROUND_DECISION),
    redis.get(RedisDatabaseKey.ROUND_DECISION + '.' + exchangePair.name),
    redis.get(RedisDatabaseKey.TRADE_MODE),
    // publishPlatformBalanceSignal(prisma, publisher),
    prisma.insuranceTransaction.aggregate({
      _sum: {
        amount: true,
      },
    }),
    publisher.get('platformCut'),
  ])
  let tradeMode =
    redisTradeMode && Object.values(TradeMode).includes(redisTradeMode as any)
      ? (redisTradeMode as TradeMode)
      : DEFAULT_TRADE_MODE

  if (
    tradeMode === TradeMode.AUTO_BALANCE &&
    // totalWinAmount._sum.win_amount >= totalBetAmount._sum.bet_amount &&
    new BigNumber(totalWinAmount._sum.win_amount)
      .plus(totalInSurance._sum.amount)
      .plus(totalCut)
      .isGreaterThanOrEqualTo(totalBetAmount._sum.bet_amount) &&
    totalUpVolume._sum.bet_amount !== totalDownVolume._sum.bet_amount
  ) {
    tradeMode = TradeMode.AUTO_GAIN
  } else if (
    tradeMode === TradeMode.AUTO_BALANCE &&
    // totalWinAmount._sum.win_amount < totalBetAmount._sum.bet_amount
    new BigNumber(totalWinAmount._sum.win_amount)
      .plus(totalInSurance._sum.amount)
      .plus(totalCut)
      .isLessThan(totalBetAmount._sum.bet_amount)
  ) {
    tradeMode = TradeMode.NATURE
  }

  let decision: Decision = 'DOWN'

  if (redisDecision) {
    decision = redisDecision as Decision
    publisher.publish('decision', JSON.stringify({ decision }))
  } else {
    switch (tradeMode) {
      case TradeMode.NATURE:
        return order
      case TradeMode.NATURE_PLUS:
        return order
      case TradeMode.AUTO_GAIN:
        if (
          (totalUpVolume._sum.bet_amount === 0 &&
            totalDownVolume._sum.bet_amount === 0) ||
          totalUpVolume._sum.bet_amount === totalDownVolume._sum.bet_amount
        ) {
          return order
        } else {
          decision =
            totalUpVolume._sum.bet_amount < totalDownVolume._sum.bet_amount
              ? 'UP'
              : 'DOWN'
        }
        break
      default:
        decision =
          totalUpVolume._sum.bet_amount > totalDownVolume._sum.bet_amount
            ? 'UP'
            : 'DOWN'
        break
    }
  }

  // totalUpOrders === 0 && totalDownOrders === 1 && (decision = 'BALANCE')
  // totalUpOrders === 1 && totalDownOrders === 0 && (decision = 'BALANCE')
  console.log(
    `🚀 [${exchangePair.name}] Trade mode: ${tradeMode}, decision: ${decision}`,
  )

  let price = new BigNumber(binaceOrder.price)
  // console.log('Order price - bn price: ', price.toFixed(8), binaceOrder.price)

  switch (decision) {
    case 'UP':
      price = BigNumber.max(binaceOrder.price, openPrice).plus(
        randomFromRangeWithStep(
          0,
          Math.abs(Number(binaceOrder.price) - Number(openPrice)),
        ),
      )
      break
    case 'DOWN':
      price = BigNumber.min(binaceOrder.price, openPrice).minus(
        randomFromRangeWithStep(
          0,
          Math.abs(Number(binaceOrder.price) - Number(openPrice)),
        ),
      )
      break
    case 'BALANCE':
      if (countDown === 1) {
        price = new BigNumber(openPrice)
      }
      break
  }

  const ord = { ...order }
  ord.price = price.toFixed()
  // console.log('cooked price: ', ord.price)

  return ord
}

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
