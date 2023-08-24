import { Prisma } from '@prisma/client'
import { objectType } from 'nexus'
import { Context } from '../../context'
import math from '../../lib/math'
import { getExchangeWalletBalance } from '../../utils'

interface ExchangeDetail {
  totalRound: number
  totalTradeAmount: number
  winRound: number
  loseRound: number
  drawRound: number
  refundRound: number
  revenue: number
  profit: number
  ref: number // ref comission
  transferIn: number
  transferOut: number
  promotionCode: number
  promotion: number
  refund: number
  agency: number
  totalIn: number
  totalOut: number
  convertIn: number
  convertOut: number
  balance: number
}
export interface ExchangeSumary {
  main: ExchangeDetail
  promotion: ExchangeDetail
  demo: ExchangeDetail
  // totalDeposit: number
  // totalWithdraw: number
}

interface ExchangeWalletSumary {
  bet: number
  revenue: number
  ref: number // ref comission
  transferIn: number
  transferOut: number
  promotionCode: number
  promotion: number
  refund: number
  agency: number
  totalIn: number
  totalOut: number
  convertIn: number
  convertOut: number
  balance: number
}

interface OrderResultSumary {
  account_type: string
  revenue: number
}
interface GroupSumary {
  key: string
  amount: number
}

export const reportFollowTypePayload = objectType({
  name: 'ExchangeDetail',
  definition: (t) => {
    t.float('totalTradeAmount', { nullable: true })
    t.float('totalRound', { nullable: true })
    t.float('winRound', { nullable: true })
    t.float('loseRound', { nullable: true })
    t.float('drawRound', { nullable: true })
    t.float('refundRound', { nullable: true })
    t.float('revenue', { nullable: true })
    t.float('profit', { nullable: true })
    t.float('ref', { nullable: true })
    t.float('transferIn', { nullable: true })
    t.float('transferOut', { nullable: true })
    t.float('promotionCode', { nullable: true })
    t.float('promotion', { nullable: true })
    t.float('refund', { nullable: true })
    t.float('agency', { nullable: true })
    t.float('totalIn', { nullable: true })
    t.float('totalOut', { nullable: true })
    t.float('convertIn', { nullable: true })
    t.float('convertOut', { nullable: true })
    t.float('balance', { nullable: true })
  },
})

export const exchangeWalletSumary = objectType({
  name: 'ExchangeWalletSumary',
  definition: (t) => {
    t.float('bet', { nullable: true })
    t.float('win', { nullable: true })
    t.float('ref', { nullable: true })
    t.float('transferIn', { nullable: true })
    t.float('transferOut', { nullable: true })
    t.float('promotionCode', { nullable: true })
    t.float('promotion', { nullable: true })
    t.float('refund', { nullable: true })
    t.float('agency', { nullable: true })
    t.float('totalIn', { nullable: true })
    t.float('totalOut', { nullable: true })
    t.float('convertIn', { nullable: true })
    t.float('convertOut', { nullable: true })
    t.float('balance', { nullable: true })
    t.float('manualIn', { nullable: true })
  },
})

export async function getExchangeWalletSumary(ctx: Context, user_id: string) {
  let walletSumary: ExchangeWalletSumary = {
    bet: 0,
    revenue: 0,
    transferIn: 0,
    transferOut: 0,
    promotion: 0,
    promotionCode: 0,
    ref: 0,
    refund: 0,
    agency: 0,
    totalIn: 0,
    totalOut: 0,
    convertIn: 0,
    convertOut: 0,
    balance: 0,
  }
  let wallets = await ctx.prisma.exchangeWallet.findMany({
    where: {
      type: {
        not: 'DEMO',
      },
      user_id,
    },
    // take: 1,
  })

  let walletChanges = await ctx.prisma.exchangeWalletChange.findMany({
    where: {
      exchange_wallet_id: {
        in: wallets.map((item) => item.id),
      },
    },
  })
  // console.log('walletChanges: ', walletChanges.length)

  for (let item of walletChanges) {
    // set total in/out
    if (item.amount > 0) {
      // convert out
      walletSumary.totalIn = math
        .add(item.amount, walletSumary.totalIn)
        .toNumber()
    } else {
      // convertIn
      walletSumary.totalOut = math
        .add(item.amount, walletSumary.totalOut)
        .toNumber()
    }

    if (item.event_type === 'CONVERT') {
      if (item.amount < 0) {
        // convert out
        walletSumary.convertOut = math
          .add(item.amount, walletSumary.convertOut)
          .toNumber()
      } else {
        // convertIn
        walletSumary.convertIn = math
          .add(item.amount, walletSumary.convertIn)
          .toNumber()
      }
    } else if (item.event_type === 'INTERNAL_TRANSACTION') {
      if (item.amount < 0) {
        // transfer out
        walletSumary.transferOut = math
          .add(item.amount, walletSumary.transferOut)
          .toNumber()
      } else {
        // transfer in
        walletSumary.transferIn = math
          .add(item.amount, walletSumary.transferIn)
          .toNumber()
      }
    } else if (item.event_type === 'AGENCY_LICENCE') {
      walletSumary.agency = math
        .add(item.amount, walletSumary.agency)
        .toNumber()
    } else if (item.event_type === 'PROMOTION') {
      walletSumary.promotion = math
        .add(item.amount, walletSumary.promotion)
        .toNumber()
    } else if (item.event_type === 'PROMOTION_CODE') {
      walletSumary.promotionCode = math
        .add(item.amount, walletSumary.promotionCode)
        .toNumber()
    } else if (item.event_type === 'REF') {
      walletSumary.ref = math.add(item.amount, walletSumary.ref).toNumber()
    } else if (item.event_type === 'REFUND') {
      walletSumary.refund = math
        .add(item.amount, walletSumary.refund)
        .toNumber()
    } else if (item.event_type === 'ORDER') {
      walletSumary.bet = math.add(item.amount, walletSumary.bet).toNumber()
    } else if (item.event_type === 'ORDER_RESULT') {
      if (item.amount > 0) {
        // win
        walletSumary.revenue = math
          .add(item.amount, walletSumary.revenue)
          .toNumber()
      }
    }
  }

  // get balance
  const balances = await Promise.all(
    wallets.map(async (item) => {
      return await getExchangeWalletBalance(item, ctx.prisma)
    }),
  )
  // console.log('balances: ', balances)
  balances.forEach((item) => {
    walletSumary.balance = math.add(item, walletSumary.balance).toNumber()
  })
  return walletSumary
}

export async function getAllExchangeBalance(ctx: Context, user_id: string) {
  let wallets = await ctx.prisma.exchangeWallet.findMany({
    where: {
      type: {
        not: 'DEMO',
      },
      user_id,
    },
  })
  const balances = await Promise.all(
    wallets.map(async (item) => {
      return await getExchangeWalletBalance(item, ctx.prisma)
    }),
  )

  let balance = 0
  balances.forEach((item) => {
    balance = math.add(item, balance).toNumber()
  })
  return balance
}
