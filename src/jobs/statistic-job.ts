import { Prisma, PrismaClient } from '@prisma/client'
import math from '../lib/math'
import { getUSDTCurrencyMap } from '../lib/convert-utils'

const prisma = new PrismaClient({
  // log: ['query', 'info', 'warn'],
})

interface SumaryData {
  key: string
  amount: number
}
export type TransactionSumary = {
  withdraw: number
  pending_withdraw: number
  deposit: number
  fee: number
  currency_id: string
}

export async function getStatistic(cachedAt: Date) {
  let withdraw = 0
  let pendingWithdraw = 0
  let deposit = 0
  let transactionFee = 0
  let balance = 0
  let bet = 0
  let win = 0

  let currencies = await prisma.currency.findMany()
  if (!currencies || currencies.length === 0) {
    return
  }
  let usdtMap = await getUSDTCurrencyMap(prisma)

  // estimate main balance
  let condition = ''
  if (cachedAt) {
    // @ts-ignore
    condition = `AND "MainWalletChange"."createdAt" > '${formatDate(cachedAt)}'`
  }
  let query = Prisma.sql`
  select SUM(amount) as amount, "currency".id as key
from "main_wallet_change", "main_wallet", "currency"
WHERE "main_wallet_change".main_wallet_id = "main_wallet".id AND "main_wallet".currency_id = "currency".id
${condition}
GROUP BY "currency".id
  `
  let balanceSumary: [SumaryData] = await prisma.$queryRaw(query)
  for (let item of balanceSumary) {
    let usdtRate = usdtMap.get(`${item.key}`) ?? 0
    const estimateUsd = math.mul(item.amount, usdtRate).toNumber()
    balance = math.add(estimateUsd, balance).toNumber()
  }

  // transaction sumary
  condition = ''
  if (cachedAt) {
    condition = `WHERE "created_at" > '${cachedAt}'`
  }
  query = Prisma.sql`
  select 
  SUM(CASE WHEN (tx_type='WITHDRAW' AND status='SUCCEED') THEN amount ELSE 0 END) as withdraw,
  SUM(CASE WHEN (tx_type='WITHDRAW' AND status='PENDING') THEN amount ELSE 0 END) as pending_withdraw,
  SUM(CASE WHEN (tx_type='DEPOSIT' AND status='SUCCEED') THEN amount ELSE 0 END) as deposit,
  SUM(fee) as fee,
  currency_id
  from "main_wallet_transaction"
  ${condition}
  GROUP BY currency_id
      `

  let transactions = await prisma.$queryRaw<[TransactionSumary]>(query)

  for (let item of transactions) {
    let usdValue = usdtMap.get(`${item.currency_id}`)
    let estimateUsd = math.mul(item.withdraw, usdValue).toNumber()
    withdraw = math.add(estimateUsd, withdraw).toNumber()
    // pending withdraw
    estimateUsd = math.mul(item.pending_withdraw, usdValue).toNumber()
    pendingWithdraw = math.add(estimateUsd, pendingWithdraw).toNumber()

    // deposit
    estimateUsd = math.mul(item.deposit, usdValue).toNumber()
    // fee
    estimateUsd = math.mul(item.fee, usdValue).toNumber()
    transactionFee = math.add(estimateUsd, transactionFee).toNumber()
  }
  // aggregates sumary
  let aggregates = await Promise.all([
    prisma.convertionTransaction.aggregate({
      where: {
        direction: 'EXCHANGE_TO_MAIN',
        createdAt: {
          gt: cachedAt,
        },
      },
      _sum: {
        amount: true,
      },
    }),
    prisma.convertionTransaction.aggregate({
      where: {
        direction: 'MAIN_TO_EXCHANGE',
        createdAt: {
          gt: cachedAt,
        },
      },
      _sum: {
        converted_amount: true,
      },
    }),
    // prisma.order.aggregate({
    //   where: {
    //     account_type: {
    //       not: 'DEMO',
    //     },
    //     createdAt: {
    //       gt: cachedAt,
    //     },
    //   },
    //   _sum: {
    //     bet_amount: true,
    //   },
    // }),
    // prisma.orderResult.aggregate({
    //   where: {
    //     Order: {
    //       account_type: {
    //         not: 'DEMO',
    //       },
    //     },
    //     createdAt: {
    //       gt: cachedAt,
    //     },
    //   },
    //   _sum: {
    //     win_amount: true,
    //   },
    // }),
    prisma.refTransaction.aggregate({
      where: {
        createdAt: {
          gt: cachedAt,
        },
      },
      _sum: {
        earned: true,
      },
    }),
  ])

  let convertToMain = aggregates[0]._sum.amount
  let convertToExchange = aggregates[1]._sum.converted_amount
  let commission = aggregates[2]._sum.earned

  return {
    deposit,
    withdraw,
    pendingWithdraw,
    balance,
    // exchangeBalance,
    transactionFee,
    convertToExchange,
    convertToMain,
    bet,
    win,
    commission,
    transactions,
  }
}
export async function updateDailyStatistic() {
  let lasts = await prisma.dailyStatistic.findMany({
    orderBy: {
      createdAt: 'desc',
    },
    take: 1,
  })

  try {
    if (lasts && lasts.length > 0) {
      let statisticData = await getStatistic(lasts[0].createdAt)
      await prisma.dailyStatistic.create({
        data: {
          deposit: statisticData.deposit,
          withdraw: statisticData.withdraw,
          pendingWithdraw: statisticData.pendingWithdraw,
          transactionFee: statisticData.transactionFee,
          convertToExchange: statisticData.convertToExchange ?? 0,
          convertToMain: statisticData.convertToMain ?? 0,
          exchangeBalance: 0,
          bet: statisticData.bet ?? 0,
          win: statisticData.win ?? 0,
          balance: statisticData.balance ?? 0,
        },
      })
    } else {
      let statisticData = await getStatistic(undefined)
      let result = await prisma.dailyStatistic.create({
        data: {
          deposit: statisticData.deposit,
          withdraw: statisticData.withdraw,
          pendingWithdraw: statisticData.pendingWithdraw,
          transactionFee: statisticData.transactionFee,
          convertToExchange: statisticData.convertToExchange ?? 0,
          convertToMain: statisticData.convertToMain ?? 0,
          exchangeBalance: 0,
          bet: statisticData.bet ?? 0,
          win: statisticData.win ?? 0,
          balance: statisticData.balance ?? 0,
        },
      })
    }
  } catch (err) {
    console.log('statistic job err: ', err)
  }
}
