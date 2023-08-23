import Redis from 'ioredis'
import Binance, { WSTrade } from 'binance-api-node'
import logger from '../lib/logger'
import BigNumber from 'bignumber.js'
import { OrderResult, Prisma, PrismaClient, RoundType } from '@prisma/client'
import * as R from 'ramda'
import * as math from '../lib/math'
//@ts-ignore
import { v4 as uuidv4 } from 'uuid'
import { RedisChannel, RedisDatabaseKey } from '../lib/redis-utils'
import { groupResult } from '../lib/round-utils'
import { groupOrder } from '../lib/groupby'
import { cleanupDecision, makeDecision } from '../lib/make-decision'
import { processOrderDemo } from '../helpers/demo-order-result'
import { createUserOpinion } from '../helpers/user-opinion'
import { smoothCandleStick } from '../helpers/smooth-candle'

require('dotenv').config()

const redisHost = process.env.NODE_ENV === 'production' ? 'redis' : '127.0.0.1'

const options = {
  host: redisHost,
  port: 6379,
  retryStrategy: (times: number) => {
    // reconnect after
    return Math.min(times * 50, 2000)
  },
}

export interface ExcOrder {
  exchange: string
  pair: string
  price: string
  amount: string
  side: string
  time: number
  round: number
}

const prisma = new PrismaClient()
const redis = new Redis(options)
const subscriber = new Redis(options)
const publisher = new Redis(options)
const client = Binance()

async function main() {
  client.time().then((time) => console.log(time))

  let binaceOrder: WSTrade = {
    eventType: 'trade',
    eventTime: 1644574591529,
    tradeTime: 1644574591528,
    symbol: 'BTCUSDT',
    price: '0',
    quantity: '0.00000001',
    isBuyerMaker: true,
    maker: true,
    tradeId: 324408859,
    buyerOrderId: 2665741844,
    sellerOrderId: 2665741862,
  }

  client.ws.trades(['BTCUSDT'], async (trade) => {
    // console.log(trade)
    binaceOrder = trade
    redis.set('BTCUSDT', JSON.stringify(trade))
  })

  subscriber.subscribe('clock-machine')
  subscriber.on('message', async (channel, message) => {
    // console.log(`Channel: ${channel}`, JSON.parse(message))
    const mess = JSON.parse(message)
    // console.log('rdmessss', mess)
    await createUserOpinion(mess, publisher, redis)

    let order: ExcOrder = {
      exchange: 'binance',
      pair: 'BTCUSDT',
      price: binaceOrder.price,
      // price: price,
      amount: binaceOrder.quantity,
      side: binaceOrder.isBuyerMaker ? 'BUY' : 'SELL',
      time: new Date().getTime() * 1000,
      round: mess.roundId,
    }

    if (new BigNumber(order.price).eq(0)) {
      return
    }

    try {
      let currentRoundOrdersRedis: any[] = []
      const openPrice = await redis.get('open-price')

      // manipulate first 4 seconds price
      order = smoothCandleStick(mess, openPrice, order)

      try {
        const rdData = await redis.get('current_round_orders')
        let d = JSON.parse(rdData)

        // decide when to intercep order price and manipulate it.
        const interceptSecond = await redis.get('intercept-second')
        if (!mess.enable && mess.countDown < (Number(interceptSecond) || 10)) {
          console.log(`Start intercept order at ${mess.countDown}`)
          order = await makeDecision(
            order,
            binaceOrder,
            prisma,
            openPrice,
            redis,
            mess.countDown,
            publisher,
          )
        }
        currentRoundOrdersRedis = [...currentRoundOrdersRedis, ...d, order]
      } catch (error) {
        console.log('error parsing order in redis', error)
      }
      redis.set('current_round_orders', JSON.stringify(currentRoundOrdersRedis))

      const ordersList = currentRoundOrdersRedis
      if (!ordersList || ordersList.length === 0) {
        console.log('Cannot find order data in redis')
        return
      }

      const candleStickData = {
        open: openPrice,
        close: new BigNumber(ordersList[ordersList.length - 1].price).toFixed(),
        high: BigNumber.max(
          ...ordersList.map((i: any) => Number(i.price)),
        ).toFixed(),
        low: BigNumber.min(
          ...ordersList.map((i: any) => Number(i.price)),
        ).toFixed(),
        f: mess.countDown === 1,
        date: new Date(ordersList[0].time / 1000).getTime(),
      }

      publisher.publish('candlestick', JSON.stringify(candleStickData))

      if (mess.countDown === 1) {
        // decision = 'BALANCE'
        await redis.set('open-price', candleStickData.close)

        const { open, close } = candleStickData

        const type: RoundType =
          open === close ? 'BALANCE' : close > open ? 'UP' : 'DOWN'

        publisher.publish(
          'last-candlestick',
          JSON.stringify({
            ...candleStickData,
            type: type,
          }),
        )

        const cds = await prisma.candleStick.create({
          data: {
            open: Number(candleStickData.open),
            close: Number(candleStickData.close),
            high: Number(candleStickData.high),
            low: Number(candleStickData.low),
            date: candleStickData.date,
            f: mess.enable ? false : true,
            round_time_id: mess.roundId,
          },
        })

        await redis.set('current_round_orders', JSON.stringify([]))
        if (!mess.enable) {
          await Promise.all([
            createRoundResult(
              mess.roundId - 1,
              type,
              candleStickData.open,
              candleStickData.close,
            ),
            processOrderDemo(mess.roundId - 1, type, prisma),
            cleanupDecision(redis),
          ])
        }
      }
    } catch (error) {
      console.log('Error creating candle stick', error.message)
      await redis.set('current_round_orders', JSON.stringify([]))
    }
  })
}

main().catch((err) => console.error(`[Heart beat service] ${err.message}`, err))

async function createRoundResult(
  roundId: number,
  roundType: RoundType,
  openPrice: string,
  closePrice: string,
) {
  const round = await prisma.round.create({
    data: {
      time_id: roundId,
      type: roundType,
      open_price: parseFloat(openPrice),
      close_price: parseFloat(closePrice),
    },
  })

  const currentRoundOrders = await prisma.order.findMany({
    where: {
      round_id: roundId,
      order_result_id: null,
      account_type: {
        in: ['MAIN', 'PROMOTION'],
      },
    },
    include: {
      User: {
        include: {
          ExchangeWallet: true,
        },
      },
      ExchangePair: true,
      CopyTrade: true,
    },
  })

  if (currentRoundOrders.length === 0) {
    console.log(`No orders in round: ${roundId}`)
    return
  }
  logger.info(`===========================START===============================`)
  logger.info(`START PROCESS: ${currentRoundOrders.length} ORDERS`)

  ////////////////////////////////
  //// create OrderResult
  ////////////////////////////////
  const createOrderResultData = currentRoundOrders.map((order) => {
    const isWin = order.bet_type === roundType
    const fee = order.ExchangePair.fee_rate
    let winAmount = math
      .add(math.mul(order.bet_amount, fee).toNumber(), order.bet_amount)
      .toNumber()

    let amount = isWin
      ? winAmount
      : roundType === 'BALANCE'
      ? order.bet_amount
      : 0
    if (order.CopyTrade != null && isWin) {
      const commissionAmount = math
        .mul(order.CopyTrade.profit_sharing, order.bet_amount)
        .toNumber()
      amount = math.sub(amount, commissionAmount).toNumber()
    }

    const status = isWin ? 'WIN' : roundType === 'BALANCE' ? 'DRAW' : 'LOSE'

    return `('${uuidv4()}', NOW(), '${order.user_id}', '${order.id}', '${
      order.round_id
    }', ${isWin}, ${amount}, '${status}')`
  })

  console.time('craete-order-result')
  const createOrderResult = await prisma.$queryRawUnsafe<OrderResult[]>(`
    INSERT INTO order_result (id, updated_at, user_id, order_id, round_id, is_win, win_amount, status)
    VALUES ${createOrderResultData.join(',')} RETURNING *;
  `)
  console.timeEnd('craete-order-result')
  logger.info(`${createOrderResult.length} CREATED`)

  ////////////////////////////////
  //// link order -> order_result
  ////////////////////////////////
  const updateOrdersData = createOrderResult.map(
    (i) => Prisma.sql`WHEN ${i.order_id} THEN ${i.id}`,
  )
  const orderIds = createOrderResult.map((i) => Prisma.sql`${i.order_id}`)
  console.time('linked-order-to-order-result')
  const updateRemain = await prisma.$executeRaw(Prisma.sql`
    UPDATE "order"
    SET order_result_id = CASE id
    ${Prisma.join(updateOrdersData, ' ')}
    ELSE order_result_id END WHERE id IN(${Prisma.join(orderIds)})
  `)
  console.timeEnd('linked-order-to-order-result')
  logger.info(`LINKED ${updateRemain} ORDERS`)

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

    const wallet = order.User.ExchangeWallet.find((w) => w.type === 'MAIN')

    return `('${uuidv4()}', NOW(), ${amount}, 'ORDER_RESULT', '${
      orderResultId.id
    }', '${wallet.id}')`
  })

  console.time('create-wallet-change')
  const updatedWallets = await prisma.$executeRawUnsafe(`
    INSERT INTO "exchange_wallet_change" (id, updated_at, amount, event_type, event_id, exchange_wallet_id)
    VALUES ${walletChangesData.join(',')}
  `)
  console.timeEnd('create-wallet-change')
  logger.info(`FINISH CREATE WALLET CHANGE: ${updatedWallets}`)

  ////////////////////////////////
  //// Send Notification
  ////////////////////////////////
  const roudResultsWithBetAmount = createOrderResult.map((i, index) => {
    const order = currentRoundOrders.find((order) => order.id === i.order_id)
    if (order.account_type === 'MAIN') {
      return {
        ...i,
        bet_amount: order.bet_amount,
      }
    }
  })

  // @ts-ignore
  handlerOrderResult(createOrderResult, roudResultsWithBetAmount)

  ////////////////////////////////
  //// create copy_trade_commission
  ////////////////////////////////
  const copyTradeCommissionData = currentRoundOrders
    .map((order) => {
      const isWin = order.bet_type === roundType

      if (
        order.copy_trade_id == null ||
        !isWin ||
        order.account_type !== 'MAIN'
      ) {
        return
      }

      const profitSharing = order.CopyTrade.profit_sharing
      if (isNaN(profitSharing) || profitSharing > 1 || profitSharing <= 0) {
        return
      }

      const commissionAmount = math
        .mul(order.CopyTrade.profit_sharing, order.bet_amount)
        .toNumber()

      return Prisma.sql`(${uuidv4()}, NOW(), ${order.user_id}, ${
        order.CopyTrade.trader_id
      }, ${profitSharing}, ${commissionAmount}, ${order.copy_trade_id})`
    })
    .filter((i) => i != null)

  if (copyTradeCommissionData.length === 0) {
    return
  }

  console.time('create-copy-trade-commission')
  const copyTradeCommissionResult = await prisma.$executeRaw<
    { id: string; order_id: string }[]
  >(Prisma.sql`
    INSERT INTO copy_trade_commission (id, updated_at, copier_id, leader_id, profit_sharing, amount, copy_trade_id)
    VALUES ${Prisma.join(copyTradeCommissionData)}
    RETURNING id;
  `)
  console.timeEnd('create-copy-trade-commission')
  logger.info(`COPYTRADE COMMISSION CREATED ${copyTradeCommissionResult}`)

  ////////////////////////////////
  //// Update remain copy trade
  ////////////////////////////////
  function calculateAmount(order: any) {
    const copyTradeData = order.CopyTrade

    const isWin = order.bet_type === roundType
    const fee = order.ExchangePair.fee_rate

    let winAmount = math
      .add(math.mul(order.bet_amount, fee).toNumber(), order.bet_amount)
      .toNumber()

    if (copyTradeData != null && isWin) {
      const commissionAmount = math
        .mul(copyTradeData.profit_sharing, order.bet_amount)
        .toNumber()
      winAmount = math.sub(winAmount, commissionAmount).toNumber()
    }

    const amount = isWin
      ? winAmount
      : roundType === 'BALANCE'
      ? order.bet_amount
      : 0

    return { amount, remain: copyTradeData.remain }
  }

  function produceResult(num: number, key: string, obj: any) {
    return `WHEN '${key}' THEN ${num}`
  }

  const getUpdateCopyTradeRemainData = R.pipe(
    // @ts-ignore
    R.groupBy(R.prop('copy_trade_id')),
    // @ts-ignore
    R.map(R.map(calculateAmount)),
    R.map(sumResult),
    R.mapObjIndexed(produceResult),
    R.values,
  )

  // @ts-ignore
  const updateData: string[] = getUpdateCopyTradeRemainData(
    // @ts-ignore
    currentRoundOrders.filter((i) => i.CopyTrade != null),
  )
  const copyTradeIds = currentRoundOrders.map(
    (i) => Prisma.sql`${i.copy_trade_id}`,
  )

  console.time('update-copy-trade-remain')
  const updateCopyTradeRemain = await prisma.$executeRaw(Prisma.sql`
    UPDATE "copy_trade"
    SET remain = CASE id
    ${updateData.join(' ')}
    ELSE remain END WHERE id IN(${Prisma.join(copyTradeIds)})
  `)
  console.timeEnd('update-copy-trade-remain')
  logger.info(`FINISH UPDATE COPYTRADE REMAIN: ${updateCopyTradeRemain}`)
  logger.info(`===========================END=================================`)

  return updatedWallets
}

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

function sumResult(d: any) {
  const remain = d[0]?.remain
  const sum = d.reduce((acc: number, curr: any) => {
    return math.add(acc, curr.amount).toNumber()
  }, 0)

  return math.add(remain, sum).toNumber()
}
