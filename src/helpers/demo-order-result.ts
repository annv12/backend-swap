//@ts-ignore
import { v4 as uuidv4 } from 'uuid'
import { OrderResult, Prisma, PrismaClient, RoundType } from '@prisma/client'
import math from '../lib/math'
import logger from '../lib/logger'
import { groupResult } from '../lib/round-utils'
import Redis from 'ioredis'
import { RedisChannel } from '../lib/redis-utils'
import { groupOrder } from '../lib/groupby'

type RoundResultsWithBetAmount = {
  bet_amount: number
  id: string
  createdAt: Date
  updatedAt: Date
  round_id: string
  is_win: boolean
  win_amount: number
  status: 'WIN' | 'DRAW' | 'LOSE' | 'REFUND'
  user_id: string
}

const redisHost = process.env.NODE_ENV === 'production' ? 'redis' : '127.0.0.1'

const options = {
  host: redisHost,
  port: 6379,
  retryStrategy: (times: number) => {
    // reconnect after
    return Math.min(times * 50, 2000)
  },
}

const publisher = new Redis(options)

export async function processOrderDemo(
  roundId: number,
  roundType: RoundType,
  prisma: PrismaClient,
) {
  const currentRoundOrders = await prisma.orderDemo.findMany({
    where: {
      round_id: roundId,
      order_result_id: null,
    },
    include: {
      User: {
        include: {
          ExchangeWallet: true,
        },
      },
      ExchangePair: true,
    },
  })
  logger.debug('currentRoundOrdersDemo: ', { count: currentRoundOrders.length })
  if (currentRoundOrders.length === 0) {
    return
  }
  ////////////////////////////////
  //// create OrderResult
  ////////////////////////////////
  const createOrderResultData = currentRoundOrders.map((order) => {
    const isWin = order.bet_type === roundType
    const fee = order.ExchangePair.fee_rate
    let winAmount = math
      .add(math.mul(order.bet_amount, fee).toNumber(), order.bet_amount)
      .toNumber()

    const amount = isWin
      ? winAmount
      : roundType === 'BALANCE'
      ? order.bet_amount
      : 0

    const status = isWin ? 'WIN' : roundType === 'BALANCE' ? 'DRAW' : 'LOSE'

    return `('${uuidv4()}', NOW(), '${order.user_id}', '${order.id}', '${
      order.round_id
    }', ${isWin}, ${amount}, '${status}')`
  })

  const createOrderResult = await prisma.$queryRawUnsafe<OrderResult[]>(`
    INSERT INTO order_result_demo (id, updated_at, user_id, order_id, round_id, is_win, win_amount, status)
    VALUES ${createOrderResultData.join(',')}
    RETURNING *;
  `)

  ////////////////////////////////
  //// link order -> order_result
  ////////////////////////////////
  const updateOrdersData = createOrderResult.map(
    (i) => Prisma.sql`WHEN ${i.order_id} THEN ${i.id}`,
  )
  const orderIds = createOrderResult.map((i) => Prisma.sql`${i.order_id}`)
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "order_demo"
    SET order_result_id = CASE id
    ${Prisma.join(updateOrdersData, ' ')}
    ELSE order_result_id END WHERE id IN(${Prisma.join(orderIds)})
  `)

  ////////////////////////////////
  //// create walletChange
  ////////////////////////////////
  const walletChangesData = currentRoundOrders.map((order) => {
    const orderResultId = createOrderResult.find((r) => r.order_id === order.id)
    const isWin = order.bet_type === roundType
    const fee = order.ExchangePair.fee_rate
    let winAmount = math
      .add(math.mul(order.bet_amount, fee).toNumber(), order.bet_amount)
      .toNumber()

    const amount = isWin
      ? order.account_type === 'PROMOTION'
        ? math.mul(order.bet_amount, fee).toNumber()
        : winAmount
      : roundType === 'BALANCE'
      ? order.bet_amount
      : 0

    const wallet = order.User.ExchangeWallet.find(
      (w) => w.type === order.account_type,
    )

    return `('${uuidv4()}', NOW(), ${amount}, 'ORDER_RESULT', '${
      orderResultId.id
    }', '${wallet.id}')`
  })

  const updatedWallets = await prisma.$executeRawUnsafe(`
    INSERT INTO "exchange_wallet_change_demo" (id, updated_at, amount, event_type, event_id, exchange_wallet_id)
    VALUES ${walletChangesData.join(',')}
  `)

  ////////////////////////////////
  //// Send Notification
  ////////////////////////////////
  const roudResultsWithBetAmount = createOrderResult.map((i, index) => {
    const order = currentRoundOrders.find((order) => order.id === i.order_id)
    return {
      ...i,
      bet_amount: order.bet_amount,
    }
  })

  // @ts-ignore
  handlerOrderResult(createOrderResult, roudResultsWithBetAmount)
}

function handlerOrderResult(
  roundResults: OrderResult[],
  roudResultsWithBetAmount: RoundResultsWithBetAmount[],
  // roundResults: any,
  // roudResultsWithBetAmount: any,
) {
  const orderData = roudResultsWithBetAmount
    .filter((i) => i?.status === 'WIN')
    .filter(Boolean)
  logger.info(`[Tournament] OrderData: `, { count: orderData.length })
  // @ts-ignore
  const result = groupOrder(orderData)
  logger.info(`[Tournament] grouped data`, result)
  const eventData = Object.keys(result).map((i: any) => {
    return result[i]
  })
  publisher.publish(
    RedisChannel.EVENT_ORDER_RESULT,
    // @ts-ignore
    JSON.stringify(eventData),
  )
  // Grouped result and send notification
  const groupedResults = groupResult(roundResults)
  Object.keys(groupedResults).forEach((i) => {
    if (groupedResults[i].win) {
      logger.info(`Publish WIN: user-round-result.${i}`, groupedResults[i].win)
      publisher.publish(
        `user-round-result.${i}`,
        JSON.stringify(groupedResults[i].win),
        function (err) {
          if (err) throw err
          logger.info('Sent user order result to user: ', { user: i })
        },
      )
    }
    if (groupedResults[i].lose) {
      logger.info(
        `Publish LOSE: user-round-result.${i}`,
        groupedResults[i].lose,
      )
      publisher.publish(
        `user-round-result.${i}`,
        JSON.stringify(groupedResults[i].lose),
        function (err) {
          if (err) throw err
          logger.info('Sent user order result to user: ', { user: i })
        },
      )
    }
  })
  publisher.publish(`round-orders-result`, JSON.stringify(roundResults))
}
