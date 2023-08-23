import {
  BetType,
  CopyTrade,
  ExchangePair,
  ExchangeWallet,
  ExchangeWalletEventType,
  Order,
  OrderResult,
  Prisma,
  PrismaClient,
  Round,
  RoundType,
  User,
} from '@prisma/client'
import BigNumber from 'bignumber.js'
import Binance, { WSTrade } from 'binance-api-node'
import Redis from 'ioredis'
import { processOrderDemo } from '../helpers/handle-demo-order-result'
import logger from '../lib/logger'
import { smoothCandleStick } from '../helpers/smooth-candle'
import { cleanupDecision, makeDecision, TradeMode } from '../lib/make-decision'
import { RedisChannel, RedisDatabaseKey } from '../lib/redis-utils'
import * as R from 'ramda'
import * as math from '../lib/math'
//@ts-ignore
import { v4 as uuidv4 } from 'uuid'
import { groupResult } from '../lib/round-utils'
import { groupOrder } from '../lib/groupby'
import { createUserOpinion } from '../helpers/user-opinion'
import { Stack } from '../lib/stack'
import { pushNotication } from '../lib/notify-utils'
import { Context } from '../context'
import { RedisPubSub } from 'graphql-redis-subscriptions'
import { sendCommissionMessage } from '../lib/redis-queue-utils'
import RedisSMQ from 'rsmq'

export interface ExchangeOrder {
  exchange: string
  pair: string
  price: string
  amount: string
  side: string
  time: number
  round: number
}

export interface OpenPricesData {
  pair: string
  openPrice: string
}

const redisHost = process.env.NODE_ENV === 'production' ? 'redis' : '127.0.0.1'

const rsmq = new RedisSMQ({ host: redisHost, port: 6379, ns: 'rsmq' })

const redisOptions = {
  host: redisHost,
  port: 6379,
  retryStrategy: (times: number) => {
    // reconnect after
    return Math.min(times * 50, 2000)
  },
}

const binanceClient = Binance()
const prisma = new PrismaClient()
const redis = new Redis(redisOptions)
const subscriber = new Redis(redisOptions)
const publisher = new Redis(redisOptions)
const pubsub = new RedisPubSub({
  publisher,
  subscriber,
})

async function main() {
  console.log('[HEART BREAT SERVICE v2] Starting...')
  const exchangePairs = await prisma.exchangePair.findMany()

  let tempOrders = exchangePairs.map((i) => {
    return {
      eventType: 'trade',
      eventTime: 1644574591529,
      tradeTime: 1644574591528,
      symbol: i.name,
      price: '0',
      quantity: '0.00000001',
      isBuyerMaker: true,
      maker: true,
      tradeId: 324408859,
      buyerOrderId: 2665741844,
      sellerOrderId: 2665741862,
    }
  })

  let holders = exchangePairs.map((i) => {
    return {
      symbol: i.name,
      stack: new Stack<WSTrade>(),
    }
  })

  // get latest order from binance and set to local variable `tempOrders`
  binanceClient
    .time()
    .then((time) =>
      console.log('[HEART BREAT SERVICE v2] binanceClient time: ', time),
    )
  binanceClient.ws.trades(
    exchangePairs.map((i) => i.name),
    async (trade) => {
      // console.log(trade)
      const newTempOrds = tempOrders.map((i) => {
        if (i.symbol === trade.symbol) {
          return trade
        }
        return i
      })
      tempOrders = newTempOrds

      const STACKSIZE = 10

      holders = [...holders].map((i) => {
        if (i.symbol === trade.symbol) {
          // console.log("====================NEW", trade.price)
          i.stack.Push(trade)
        } else {
          if (i.stack.Size() === STACKSIZE) {
            const da = [...i.stack.Get()]
            const min = da.reduce((a, b) => {
              // @ts-ignore
              return new BigNumber(a.price).lte(b.price) ? a : b
            }, 0)

            const max = da.reduce((a, b) => {
              // @ts-ignore
              return new BigNumber(a.price).gt(b.price) ? a : b
            }, 0)

            // @ts-ignore
            let change = new BigNumber(max.price).minus(min.price)
            // @ts-ignore
            if (new BigNumber(max.price).minus(min.price).lt(0)) {
              change = new BigNumber(0)
            }

            // const price =
            //   Number(i.stack.Top().price) +
            //   randomFromRangeWithStep(0, change.div(10).toNumber(), 0.0001)

            // @ts-ignore
            const price = new BigNumber(min.price).plus(
              BigNumber.random(10).times(change),
            )

            const pp = { ...trade, symbol: i.symbol, price: price.toFixed(8) }
            // console.log("====================", pp)
            i.stack.Push(pp)
          }
        }

        if (i.stack.Size() > STACKSIZE) {
          i.stack.Pop()
        }

        return i
      })
    },
  )

  // subscribe to clock-machine channel and process data in each tick
  subscriber.subscribe(RedisChannel.CLOCK_MACHINE_TICK)
  subscriber.on('message', async (channel, message) => {
    const mess: {
      countDown: number
      enable: boolean
      roundId: number
    } = JSON.parse(message)
    createUserOpinion(mess, publisher, redis)
    // console.log('🚀 ', mess)

    let exChangeOrders: ExchangeOrder[] = holders
      .map((i) => {
        // const sData = [...i.stack.Get()].filter((i) => i.price !== '0')
        // const low = sData.reduce((a: any, b) => {
        //   // @ts-ignore
        //   return new BigNumber(a.price).lte(b.price) ? a.price : b.price
        // }, 0)
        // const high = sData.reduce((a: any, b) => {
        //   // @ts-ignore
        //   return new BigNumber(a.price).gt(b.price) ? a.price : b.price
        // }, 0)

        // const price = new BigNumber(low).plus(
        //   BigNumber.random(10).times(new BigNumber(high.price).minus(low.price)),
        // )

        return {
          exchange: 'binance',
          pair: i.symbol,
          price: i.stack.Top()?.price ?? '0',
          amount: i.stack.Top()?.quantity ?? '0',
          side: i.stack.Top()?.isBuyerMaker ? 'BUY' : 'SELL',
          time: i.stack.Top()?.tradeTime || new Date().getTime(),
          round: mess.roundId,
        }
      })
      .filter((i) => i.price !== '0')

    // console.log(
    //   '🚀 ~> file: binance-order.ts ~> line 95 ~> subscriber.on ~> exChangeOrders',
    //   exChangeOrders,
    // )

    try {
      // let currentRoundOrdersRedis: ExchangeOrder[] = []

      const rdOrdersDataRaw = await redis.get('current-round-orders')
      let rdOrdersData: ExchangeOrder[] = null

      try {
        rdOrdersData = JSON.parse(rdOrdersDataRaw)
      } catch (error) {
        console.log(
          '🚀 ~> file: binance-order.ts ~> line 129 ~> subscriber.on ~> error',
          error,
        )
      }

      if (!rdOrdersData || !Array.isArray(rdOrdersData)) {
        rdOrdersData = []
      }

      const openPrices: OpenPricesData[] =
        JSON.parse(await redis.get('open-prices')) ||
        exchangePairs.map((i) => ({ pair: i.name, openPrice: '0' }))

      exChangeOrders = exChangeOrders.map((order) => {
        const openPriceData = openPrices.find((i) => i.pair === order.pair)
        if (!openPriceData) return order
        return smoothCandleStick(mess, openPriceData.openPrice, order)
      })

      const interceptSecond = await redis.get('intercept-second')

      if (!mess.enable && mess.countDown < (Number(interceptSecond) || 10)) {
        console.log(`Start intercept order at ${mess.countDown}`)
        exChangeOrders = await Promise.all(
          exChangeOrders.map(async (order) => {
            const binanceOrder = tempOrders.find((i) => i.symbol === order.pair)
            const openPriceData = openPrices.find((i) => i.pair === order.pair)
            const exchangePair = exchangePairs.find(
              (i) => i.name === order.pair,
            )

            if (!binanceOrder || !openPriceData || !exchangePair) {
              console.log(
                "Un meet condition, can't intercept order for ",
                order.pair,
              )
              return order
            }

            return await makeDecision(
              order,
              binanceOrder,
              prisma,
              openPriceData.openPrice,
              redis,
              mess.countDown,
              publisher,
              exchangePair,
            )
          }),
        )
      }

      const ords = [...rdOrdersData, ...exChangeOrders]

      await redis.set('current-round-orders', JSON.stringify(ords))

      const ordersList = ords
      if (!ordersList || ordersList.length === 0) {
        console.log('Cannot find order data in redis')
        return
      }

      const candleStick = exchangePairs
        .filter((i) => {
          const orderListByCurrency = ordersList.filter(
            (order) => order.pair === i.name,
          )
          return orderListByCurrency.length > 0
        })
        .map((i) => {
          const openPrice = openPrices.find((order) => i.name === order.pair)
          const orderListByCurrency = ordersList.filter(
            (order) => order.pair === i.name,
          )

          return {
            pair: i.name,
            pairId: i.id,
            open: openPrice?.openPrice || '0',
            close: new BigNumber(
              orderListByCurrency[orderListByCurrency.length - 1].price,
            ).toFixed(),
            high: BigNumber.max(
              ...orderListByCurrency.map((i: any) => Number(i.price)),
            ).toFixed(),
            low: BigNumber.min(
              ...orderListByCurrency.map((i: any) => Number(i.price)),
            ).toFixed(),
            f: mess.countDown === 1,
            // date: new Date(orderListByCurrency[0].time / 1000).getTime(),
            date: Number(orderListByCurrency[0].time),
            volume: orderListByCurrency
              .reduce(
                (a: BigNumber, b: ExchangeOrder) =>
                  a.plus(new BigNumber(b.amount).times(100_000)),
                new BigNumber(0),
              )
              .toFixed(),
          }
        })

      // Publish candlestick data to candlestick channel
      await Promise.all(
        candleStick.map(async (i) => {
          return publisher.publish(`candlestick.${i.pair}`, JSON.stringify(i))
        }),
      )

      // if end of BET round
      if (mess.countDown === 30 && !mess.enable) {
        ////////////////////////////////
        //// handle revert NATURE_PLUS
        ////////////////////////////////
        let redisTradeMode = await redis.get(RedisDatabaseKey.TRADE_MODE)
        let tradeMode =
          redisTradeMode &&
          Object.values(TradeMode).includes(redisTradeMode as any)
            ? (redisTradeMode as TradeMode)
            : TradeMode.AUTO_GAIN
        if (tradeMode == TradeMode.NATURE_PLUS) {
          const createRoundResultByPair = exchangePairs
            .filter((i) => {
              const cd = candleStick.find((candle) => candle.pair === i.name)
              return !!cd
            })
            .map(async (i) => {
              return await handleRevertNaturePlus(mess.roundId - 1, i.id)
              // return await createRoundResult(round, type, open, close, i)
            })
        }
      }

      if (mess.countDown === 10 && mess.enable === false) {
        ////////////////////////////////
        //// send Commission
        ////////////////////////////////
        let orders = await prisma.order.findMany({
          where: {
            round_id: mess.roundId - 1,
            // copy_trade_id: null,
            account_type: 'MAIN',
          },
        })

        console.log(`Start send commission message for ${orders.length} orders`)

        orders.forEach((order) => {
          if (order.bet_amount > 0) {
            const cmData = JSON.stringify({
              userId: order.user_id,
              betAmount: order.bet_amount,
              orderId: order.id,
            })
            sendCommissionMessage(cmData, rsmq)
          }
        })
      }

      ////////////////////////////////
      //// Handle End of Round
      ////////////////////////////////
      if (mess.countDown === 1) {
        const openPrices = exchangePairs
          .filter((i) => {
            const orderListByCurrency = ordersList.filter(
              (order) => order.pair === i.name,
            )
            return orderListByCurrency.length > 0
          })
          .map((i) => {
            const orderListByCurrency = ordersList.filter(
              (order) => order.pair === i.name,
            )

            return {
              pair: i.name,
              openPrice: new BigNumber(
                orderListByCurrency[orderListByCurrency.length - 1].price,
              ).toFixed(),
            }
          })

        await redis.set('open-prices', JSON.stringify(openPrices))

        const r = await Promise.all(
          candleStick
            .filter((i) => Number(i.open) > 0)
            .map(async (i) => {
              const { open, close } = i
              const type: RoundType =
                open === close ? 'BALANCE' : close > open ? 'UP' : 'DOWN'

              return await Promise.all([
                publisher.publish(
                  `last-candlestick.${i.pair}`,
                  JSON.stringify({ ...i, type: type }),
                ),
                prisma.candleStick.create({
                  data: {
                    open: Number(i.open),
                    close: Number(i.close),
                    high: Number(i.high),
                    low: Number(i.low),
                    date: i.date,
                    f: mess.enable ? false : true,
                    round_time_id: mess.roundId,
                    exchange_pair_id: i.pairId,
                    volume: Number(i.volume),
                  },
                }),
              ])
            }),
        )

        await redis.set('current-round-orders', JSON.stringify([]))

        // if end of RESULT round
        if (!mess.enable) {
          let round: Round = null
          try {
            round = await prisma.round.create({
              data: {
                time_id: mess.roundId - 1,
                type: 'BALANCE',
                open_price: 0,
                close_price: 0,
              },
            })
          } catch (error) {
            console.log(`round ${mess.roundId - 1} already exist`)
            round = await prisma.round.findUnique({
              where: {
                time_id: mess.roundId - 1,
              },
            })
          }

          const handleDemoOrderResultByPair = exchangePairs
            .filter((i) => {
              const cd = candleStick.find((candle) => candle.pair === i.name)
              return !!cd
            })
            .map(async (i) => {
              const { open, close } = candleStick.find(
                (candle) => candle.pair === i.name,
              )

              const type: RoundType =
                open === close ? 'BALANCE' : close > open ? 'UP' : 'DOWN'

              return await processOrderDemo(
                mess.roundId - 1,
                type,
                i.id,
                prisma,
              )
            })

          const createRoundResultByPair = exchangePairs
            .filter((i) => {
              const cd = candleStick.find((candle) => candle.pair === i.name)
              return !!cd
            })
            .map(async (i) => {
              const { open, close } = candleStick.find(
                (candle) => candle.pair === i.name,
              )

              const type: RoundType =
                open === close ? 'BALANCE' : close > open ? 'UP' : 'DOWN'

              return await createRoundResult(round, type, open, close, i)
            })

          const cleanupRedisDecisions = exchangePairs.map(async (i) => {
            return await cleanupDecision(redis, i)
          })

          await Promise.all([
            Promise.all(handleDemoOrderResultByPair),
            Promise.all(createRoundResultByPair),
            // cleanupDecision(redis),
            Promise.all(cleanupRedisDecisions),
          ])
          await sendWinNotification(round)
        }
      }
    } catch (error) {
      console.log(
        '🚀 ~> file: binance-order.ts ~> line 81 ~> subscriber.on ~> error',
        error,
      )
    }
  })
}

main().catch((err) =>
  console.error(`[HEART BREAT SERVICE v2] ${err.message}`, err),
)
// .finally(() => process.exit())

async function createRoundResult(
  round: Round,
  roundType: RoundType,
  openPrice: string,
  closePrice: string,
  exchangePair: ExchangePair,
) {
  // const round = await prisma.round.create({
  //   data: {
  //     time_id: roundId,
  //     type: roundType,
  //     open_price: parseFloat(openPrice),
  //     close_price: parseFloat(closePrice),
  //   },
  // })

  const roundResult = await prisma.roundResult.create({
    data: {
      time_id: round.time_id,
      type: roundType,
      open_price: parseFloat(openPrice),
      close_price: parseFloat(closePrice),
      exchange_pair_id: exchangePair.id,
      round_id: round.id,
    },
  })

  const currentRoundOrders = await prisma.order.findMany({
    where: {
      round_id: round.time_id,
      order_result_id: null,
      account_type: {
        in: ['MAIN', 'PROMOTION'],
      },
      exchange_pair_id: exchangePair.id,
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
    console.log(`[${exchangePair.name}] No orders in round: ${round.time_id}`)
    return
  }

  logger.info(
    `[${exchangePair.name}]===========================START===============================`,
  )
  logger.info(
    `[${exchangePair.name}] START PROCESS: ${currentRoundOrders.length} ORDERS`,
  )

  ////////////////////////////////
  //// create OrderResult
  ////////////////////////////////
  const createOrderResultData = await Promise.all(
    currentRoundOrders.map(async (order) => {
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
    }),
  )

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
  const walletChangesData = await Promise.all(
    currentRoundOrders.map(async (order) => {
      const orderResultId = createOrderResult.find(
        (r) => r.order_id === order.id,
      )
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
    }),
  )

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
  function calculateAmount(order: AA) {
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

  type AA = Order & {
    User: User & {
      ExchangeWallet: ExchangeWallet[]
    }
    ExchangePair: ExchangePair
    CopyTrade: CopyTrade
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
  const copyTradeIds = currentRoundOrders
    .filter((i) => i.copy_trade_id)
    .map((i) => Prisma.sql`${i.copy_trade_id}`)

  const copyTradeIds2 = currentRoundOrders
    .filter((i) => i.copy_trade_id)
    .map((i) => `'${i.copy_trade_id}'`)

  console.time('update-copy-trade-remain')
  const updateCopyTradeRemain = await prisma.$executeRawUnsafe(`
    UPDATE "copy_trade"
    SET remain = CASE id
    ${updateData.join(' ')}
    ELSE remain END WHERE id IN(${copyTradeIds2.join(',')})
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

  publisher.publish(`round-orders-result`, JSON.stringify(roundResults))
}

function sumResult(d: { amount: number; remain: number }[]) {
  const remain = d[0]?.remain
  const sum = d.reduce((acc: number, curr: any) => {
    return math.add(acc, curr.amount).toNumber()
  }, 0)

  return math.add(remain, sum).toNumber()
}

async function sendWinNotification(round: Round) {
  const orders = await prisma.order.findMany({
    where: {
      round_id: Number(round.time_id),
    },
    include: {
      OrderResult: true,
    },
  })

  const reduction = R.reduceBy(
    (acc, next) => acc + next.OrderResult.win_amount,
    0,
    (x) => x.user_id,
    orders,
  )

  const result = Object.keys(reduction).map((key) => {
    return {
      user_id: key,
      win_amount: reduction[key],
    }
  })

  await Promise.all(
    result.map(async (i) => {
      await publisher.publish(
        `user-round-result.${i.user_id}`,
        JSON.stringify({
          id: Number(1),
          createdAt: new Date(),
          win_amount: i.win_amount,
          is_win: i.win_amount > 0 ? true : false,
          count: 1,
          user_id: 'userId',
        }),
        function (err) {
          if (err) throw err
          // logger.info('Sent user order result to user: ', { user: i })
        },
      )
    }),
  )

  logger.info(`[Round:${round.time_id}] Send win notification: `, {
    count: result.length,
  })
}

async function handleRevertNaturePlus(roundId: number, exchangePairId: string) {
  console.log(
    `Start Nature balance, pair: ${exchangePairId}, round: ${roundId}`,
  )
  const currentRoundOrder = await prisma.order.findMany({
    where: {
      round_id: roundId,
      exchange_pair_id: exchangePairId,
      // copy_trade_id: null,
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
    orderBy: {
      createdAt: 'desc',
    },
  })

  const totalVolumeUp = currentRoundOrder
    .filter((i) => i.bet_type === BetType.UP)
    .reduce((acc, curr) => {
      return acc + curr.bet_amount
    }, 0)

  const totalVolumeDown = currentRoundOrder
    .filter((i) => i.bet_type === BetType.DOWN)
    .reduce((acc, curr) => {
      return acc + curr.bet_amount
    }, 0)

  const volumeDiff = Math.abs(totalVolumeUp - totalVolumeDown)
  const typeOfHigherBetVolume: BetType =
    totalVolumeUp > totalVolumeDown ? BetType.UP : BetType.DOWN

  const higherBetVolumeOrders = currentRoundOrder.filter(
    (i) => i.bet_type === typeOfHigherBetVolume,
  )

  console.log(
    `Nature balance: UP/DOWN: ${totalVolumeUp}/${totalVolumeDown}, diff: ${volumeDiff}, orders: ${currentRoundOrder.length}, higherBetVolumeOrders: ${higherBetVolumeOrders.length}`,
  )

  const originalOrders = higherBetVolumeOrders.filter((i) => !i.copy_trade_id)
  const copyOrders = higherBetVolumeOrders.filter((i) => i.copy_trade_id)

  let volumePayback = 0
  const updatedOrders = []
  for (let order of copyOrders.concat(originalOrders)) {
    if (volumePayback < volumeDiff) {
      const userWallet = order.User.ExchangeWallet.find(
        (i) => i.type === 'MAIN',
      )

      if (!userWallet) {
        console.error('Cannot find user wallet to refund')
        continue
      }

      const updateBetAmount =
        order.bet_amount <= volumeDiff - volumePayback
          ? 0
          : order.bet_amount - (volumeDiff - volumePayback)

      // refund full order to origin
      // 1. update order amount
      const updatedOrder = await prisma.order.update({
        where: {
          id: order.id,
        },
        data: {
          bet_amount: updateBetAmount,
        },
      })
      // 2. update exchange wallet change
      const walletChange = await prisma.exchangeWalletChange.findFirst({
        where: {
          event_type: ExchangeWalletEventType.ORDER,
          event_id: order.id,
        },
      })
      const updatedExchangeWalletChange =
        await prisma.exchangeWalletChange.update({
          where: {
            id: walletChange.id,
          },
          data: {
            amount: updateBetAmount * -1,
            event_type: ExchangeWalletEventType.INVESTING_REFUND,
          },
        })
      // 2.5 update copytrade remain if needed
      if (order.copy_trade_id) {
        const copyTrade = await prisma.copyTrade.findFirst({
          where: {
            id: order.copy_trade_id,
          },
        })
        if (copyTrade) {
          await prisma.copyTrade.update({
            where: {
              id: copyTrade.id,
            },
            data: {
              remain: {
                increment: order.bet_amount,
              },
            },
          })
        }
      }

      updatedOrders.push({
        userId: order.user_id,
        orderId: order.id,
        betAmount: order.bet_amount,
        updateBetAmount,
        betType: order.bet_type,
        betTime: order.bet_time,
      })

      // 3. send notification
      // await Promise.all([
      //   pushNotication(
      //     'REVERT_INVESTING_FUND',
      //     {
      //       prisma,
      //       user: order.user_id,
      //       pubsub,
      //     } as Context,
      //     `Revert Investing Fund`,
      //     `For ensuring the balance of betting fund between Call option and Put option in round ${roundId}, your investing amount now is set to \$${updateBetAmount}`,
      //   ),
      //   sendRefundNotificationSubscriptionSignal(
      //     order.user_id,
      //     order.bet_amount - updateBetAmount,
      //   ),
      // ])

      if (order.bet_amount - updateBetAmount > 0) {
        publisher.publish(
          'refund-user',
          JSON.stringify({
            roundId,
            username: order.User.username,
            amount: order.bet_amount - updateBetAmount,
          }),
          function (err) {
            if (err) throw err
            // logger.info('Sent user order result to user: ', { user: i })
          },
        )
      }
      volumePayback += order.bet_amount
    } else {
      break
    }
  }

  const byUserId = R.groupBy(R.prop('userId'), updatedOrders)

  await Promise.all(
    Object.keys(byUserId).map((userId) => {
      const orders = byUserId[userId]
      const totalBetAmount = orders.reduce((acc, curr) => {
        return acc + curr.betAmount
      }, 0)
      const totalUpdateBetAmount = orders.reduce((acc, curr) => {
        return acc + curr.updateBetAmount
      }, 0)
      const totalRefund = totalBetAmount - totalUpdateBetAmount
      if (totalRefund > 0) {
        return Promise.all([
          pushNotication(
            'REVERT_INVESTING_FUND',
            {
              prisma,
              user: userId,
              pubsub,
            } as Context,
            `Revert Investing Fund`,
            `For ensuring the balance of betting fund between Call option and Put option in round ${roundId}, your investing amount now is reverted: \$${totalRefund}`,
          ),
          sendRefundNotificationSubscriptionSignal(userId, totalRefund),
        ])
      }
    }),
  )
}
// handleRevertNaturePlus(2924498, '49d5e47f-c1ee-416b-92aa-535cf5a4638d')

async function sendRefundNotificationSubscriptionSignal(
  userId: string,
  amount: number,
) {
  await publisher.publish(
    `user-refund.${userId}`,
    JSON.stringify({
      amount,
    }),
    function (err) {
      if (err) throw err
      // logger.info('Sent user order result to user: ', { user: i })
    },
  )
}
