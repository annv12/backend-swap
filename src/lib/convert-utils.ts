require('dotenv').config()
import { PrismaClient, Prisma, ConvertionDirection } from '@prisma/client'
import BigNumber from 'bignumber.js'
import Binance, { AvgPriceResult, OrderSide, OrderType } from 'binance-api-node'
import fetch from 'node-fetch'
import config from '../config'
import * as math from '../lib/math'

const client = Binance({
  apiKey: process.env.BINANCE_API_KEY,
  apiSecret: process.env.BINANCE_SECRET_KEY,
})
// const prisma = new PrismaClient()

async function getPrice(pair_name: string) {
  const avg_price = (await client.avgPrice({
    symbol: pair_name.toUpperCase(),
  })) as AvgPriceResult
  return Number(avg_price.price)
}

export async function getUSDTPrice(symbol: string, prisma: PrismaClient) {
  // const pair_name = symbol + '/' + 'USD'

  // const convertion_pairs = await prisma.convertionPair.findMany({
  //   where: {
  //     // is_enable: true,
  //     name: pair_name.toUpperCase(),
  //   },
  //   include: {
  //     Currency: true,
  //   },
  //   take: 1,
  // })
  // const convertion_pair = convertion_pairs[0]
  // if (!convertion_pair) return

  let base_price = 0
  if (symbol === 'USDT') {
    base_price = 1
  } else {
    const binance_pair_name = symbol + 'USDT'
    base_price = await getPrice(binance_pair_name.toUpperCase())
  }
  return base_price
}

export async function getUSDTCurrencyMap(prisma: PrismaClient) {
  let usdtMap = new Map()
  let currencies = await prisma.currency.findMany()
  if (!currencies || currencies.length === 0) {
    return usdtMap
  }

  for (let item of currencies) {
    // cache usdt rate
    let usdtRate = await getUSDTPrice(item.symbol, prisma)
    // console.log('usdt: ', usdt)
    usdtMap.set(`${item.id}`, usdtRate)
  }
  return usdtMap
}

export async function getConvertPrice(
  symbol: string,
  direction: string,
  prisma: PrismaClient,
) {
  const pair_name = symbol + '/' + 'USD'

  const convertion_pairs = await prisma.convertionPair.findMany({
    where: {
      is_enable: true,
      name: pair_name.toUpperCase(),
    },
    include: {
      Currency: true,
    },
    take: 1,
  })
  const convertion_pair = convertion_pairs[0]
  if (!convertion_pair) {
    throw new ValidationError(
      `Convertion pair ${pair_name.toUpperCase()} not found`,
    )
  }

  let base_price = 0
  if (symbol.includes('USD')) {
    base_price = 1
  } else if (config.priceConfigableCurrencies.has(symbol)) {
    base_price = convertion_pair.Currency.admin_config_price
  } else {
    const binance_pair_name = symbol + 'USDT'
    base_price = await getPrice(binance_pair_name.toUpperCase())
  }

  let convert_price = 0
  if (direction === 'MAIN_TO_EXCHANGE') {
    const buy_fee = math
      .add(
        math.mul(base_price, convertion_pair.buy_fee_pct).toNumber(),
        convertion_pair.buy_fee_flat,
      )
      .toNumber()
    convert_price = math.sub(base_price, buy_fee).toNumber()
  } else {
    const sell_fee = math
      .add(
        math.mul(base_price, convertion_pair.sell_fee_pct).toNumber(),
        convertion_pair.sell_fee_flat,
      )
      .toNumber()
    convert_price = math.div(1, base_price + sell_fee).toNumber()
  }
  return Number(convert_price.toFixed(8))
  // return Number(base_price)
}

export async function exchangeWithBinance(
  symbol: string,
  side: OrderSide,
  amount: number,
) {
  try {
    const order_res = await client.order({
      symbol: symbol,
      side: side,
      type: OrderType.MARKET,
      quantity: amount.toFixed(5),
    })
    console.log(order_res)
  } catch (error) {
    console.log(error)
  }
}

export async function updateTBRPriceData(amount: number, prisma: PrismaClient) {
  const currency = await prisma.currency.findFirst({
    where: { symbol: 'TBR' },
  })

  const totalVolumeConvertion = await prisma.convertionTransaction.aggregate({
    where: {
      createdAt: {
        gt: currency.admin_config_volume_cache_time || new Date(2022, 1, 1),
      },
      ConvertionPair: {
        name: 'TBR/USD',
      },
    },
    _sum: {
      amount: true,
    },
  })

  const volume = totalVolumeConvertion._sum.amount ?? 0
  const increaseStep = new BigNumber(amount)
    .div(currency.admin_config_price_price_step)
    .integerValue(BigNumber.ROUND_DOWN)
  const newPrice = new BigNumber(currency.admin_config_price).plus(increaseStep)
  if (
    volume >
    currency.admin_config_price_volume_step + currency.admin_config_total_volume
  ) {
    // update total volume in currency
    await prisma.currency.update({
      where: {
        id: currency.id,
      },
      data: {
        admin_config_total_volume: currency.admin_config_total_volume + volume,
        admin_config_price: newPrice.toNumber(),
      },
    })
  }
}

export async function getMaxConvertToTBRAmount(
  userId: string,
  convertionPairId: string,
  prisma: PrismaClient,
) {
  const totalBetAmount = await prisma.order.aggregate({
    where: {
      user_id: userId,
    },
    _sum: { bet_amount: true },
  })
  const totalWinAmount = await prisma.orderResult.aggregate({
    where: {
      user_id: userId,
    },
    _sum: { win_amount: true },
  })
  const profit =
    (totalWinAmount._sum.win_amount ?? 0) - (totalBetAmount._sum.bet_amount ?? 0)
  const totalCommission = await prisma.refTransaction.aggregate({
    where: {
      sponsor_id: userId,
    },
    _sum: {
      earned: true,
    },
  })

  const converted = await prisma.convertionTransaction.aggregate({
    where: {
      user_id: userId,
      convertion_pair_id: convertionPairId,
    },
    _sum: { converted_amount: true },
  })

  const maxOut = new BigNumber(profit)
    .plus(totalCommission._sum.earned ?? 0)
    .minus(converted._sum.converted_amount ?? 0)
    .toNumber()

  return maxOut
}

/**
 *  Save total_convert_in/out to convertionPair
 */
export async function updatePlatformConvertionVolume(
  convertionPairId: string,
  amount: number,
  direction: ConvertionDirection,
  prisma: PrismaClient,
) {
  const updateConvertionPairInput: Prisma.ConvertionPairUpdateArgs = {
    where: {
      id: convertionPairId,
    },
    data: {
      total_convert_out: {
        increment: direction === 'EXCHANGE_TO_MAIN' ? amount : 0,
      },
      total_convert_in: {
        increment: direction === 'MAIN_TO_EXCHANGE' ? amount : 0,
      },
    },
  }
  const r = await prisma.convertionPair.update(updateConvertionPairInput)
}