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

export async function exchangeSumary(ctx: Context, user_id: string) {
  let initSumary: ExchangeDetail = {
    totalTradeAmount: 0,
    winRound: 0,
    loseRound: 0,
    drawRound: 0,
    refundRound: 0,
    totalRound: 0,
    revenue: 0,
    profit: 0,

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

  let exchangeSumary: ExchangeSumary = {
    main: { ...initSumary },
    promotion: { ...initSumary },
    demo: { ...initSumary },
    // totalDeposit: totalDeposit.sum.amount ?? 0,
    // totalWithdraw: totalWithdraw.sum.amount ?? 0,
  }
  const orders = await ctx.prisma.order.findMany({
    where: {
      user_id,
    },
    include: {
      OrderResult: true,
    },
  })
  exchangeSumary = orders.reduce((obj, curr) => {
    let accType = 'main'
    let sumary = obj.main
    if (curr.account_type === 'PROMOTION') {
      sumary = obj.promotion
      accType = 'promotion'
    } else if (curr.account_type === 'DEMO') {
      sumary = obj.demo
      accType = 'demo'
    }
    const totalTradeAmount = math
      .add(sumary.totalTradeAmount, curr.bet_amount)
      .toNumber()

    let winRound = sumary.winRound
    if (
      curr.OrderResult?.is_win === true ||
      curr.OrderResult?.status === 'WIN'
    ) {
      winRound += 1
    }
    let loseRound = sumary.loseRound
    if (
      (!curr.OrderResult?.status && curr.OrderResult?.is_win === false) ||
      curr.OrderResult?.status === 'LOSE'
    ) {
      loseRound += 1
    }
    let drawRound = sumary.drawRound
    if (curr.OrderResult?.status === 'DRAW') {
      drawRound += 1
    }
    let refundRound = sumary.refundRound
    if (curr.OrderResult?.status === 'REFUND') {
      refundRound += 1
    }
    let totalRound = sumary.totalRound
    totalRound += 1

    return {
      ...obj,
      [accType]: {
        ...sumary,
        totalTradeAmount,
        winRound,
        loseRound,
        drawRound,
        refundRound,
        totalRound,
      },
    }
  }, exchangeSumary)
  // check and compute drawRound
  exchangeSumary.main.drawRound =
    exchangeSumary.main.totalRound -
    exchangeSumary.main.winRound -
    exchangeSumary.main.loseRound
  exchangeSumary.demo.drawRound =
    exchangeSumary.demo.totalRound -
    exchangeSumary.demo.winRound -
    exchangeSumary.demo.loseRound
  exchangeSumary.promotion.drawRound =
    exchangeSumary.promotion.totalRound -
    exchangeSumary.promotion.winRound -
    exchangeSumary.promotion.loseRound

  // check revenue
  const orderResultSumaries: [OrderResultSumary] = await ctx.prisma
    .$queryRaw(Prisma.sql`select type as account_type, SUM(amount) as revenue 
        from "exchange_wallet_change", "exchange_wallet"
         WHERE "exchange_wallet_change".exchange_wallet_id = "exchange_wallet".id
          AND "exchange_wallet_change".amount > 0 AND event_type = 'ORDER_RESULT' 
          AND user_id=${user_id} GROUP BY type`)

  orderResultSumaries.forEach((item) => {
    if (item.account_type === 'DEMO') {
      exchangeSumary.demo.revenue = item.revenue
      exchangeSumary.demo.profit = math
        .sub(item.revenue, exchangeSumary.demo.totalTradeAmount)
        .toNumber()
    } else if (item.account_type === 'MAIN') {
      exchangeSumary.main.revenue = item.revenue
      exchangeSumary.main.profit = math
        .sub(item.revenue, exchangeSumary.main.totalTradeAmount)
        .toNumber()
    } else if (item.account_type === 'PROMOTION') {
      exchangeSumary.promotion.revenue = item.revenue
      exchangeSumary.promotion.profit = math
        .sub(item.revenue, exchangeSumary.promotion.totalTradeAmount)
        .toNumber()
    }
  })

  // get other info
  let exchangeChanges: [GroupSumary] = await ctx.prisma
    .$queryRaw(Prisma.sql`select SUM(amount) as amount, event_type as key
    from "exchange_wallet", "exchange_wallet_change" 
    WHERE "exchange_wallet_change".exchange_wallet_id = "exchange_wallet".id 
    AND type != 'DEMO' AND user_id=${user_id}
    GROUP BY event_type`)
  if (exchangeChanges && exchangeChanges.length > 0) {
    exchangeChanges.forEach((item) => {
      if (item.key === 'AGENCY_LICENCE') {
        exchangeSumary.main.agency = item.amount
      } else if (item.key === 'REF') {
        exchangeSumary.main.ref = item.amount
      } else if (item.key === 'PROMOTION_CODE') {
        // promotion code only use in promotion exchange wallet
        exchangeSumary.promotion.promotionCode = item.amount
      } else if (item.key === 'PROMOTION') {
        // promotion code only use in promotion exchange wallet
        exchangeSumary.promotion.promotion = item.amount
      }
    })
  }
  // for INTERNAL_TRANSACTION (different type) + REFUND(exist in main and promotion wallet) must special check
  let exchangeWallets = await ctx.prisma.exchangeWallet.findMany({
    where: {
      user_id,
      type: 'MAIN',
    },
    take: 1,
  })
  let exchangeWallet = exchangeWallets[0]

  let transferOutResult = await ctx.prisma.exchangeWalletChange.aggregate({
    where: {
      exchange_wallet_id: exchangeWallet.id,
      event_type: 'INTERNAL_TRANSACTION',
      amount: {
        lt: 0,
      },
    },
    _sum: {
      amount: true,
    },
  })
  exchangeSumary.main.transferOut = transferOutResult._sum.amount ?? 0
  let transferInResult = await ctx.prisma.exchangeWalletChange.aggregate({
    where: {
      exchange_wallet_id: exchangeWallet.id,
      event_type: 'INTERNAL_TRANSACTION',
      amount: {
        gt: 0,
      },
    },
    _sum: {
      amount: true,
    },
  })
  exchangeSumary.main.transferIn = transferInResult._sum.amount ?? 0
  // get convert in/out
  let convertOut = await ctx.prisma.exchangeWalletChange.aggregate({
    where: {
      exchange_wallet_id: exchangeWallet.id,
      event_type: 'CONVERT',
      amount: {
        lt: 0,
      },
    },
    _sum: {
      amount: true,
    },
  })
  exchangeSumary.main.convertOut = convertOut._sum.amount ?? 0
  let convertIn = await ctx.prisma.exchangeWalletChange.aggregate({
    where: {
      exchange_wallet_id: exchangeWallet.id,
      event_type: 'CONVERT',
      amount: {
        gt: 0,
      },
    },
    _sum: {
      amount: true,
    },
  })
  exchangeSumary.main.convertIn = convertIn._sum.amount ?? 0
  //
  let refunds: [GroupSumary] = await ctx.prisma
    .$queryRaw(Prisma.sql`select SUM(amount) as amount, type as key
    from "exchange_wallet", "exchange_wallet_change" 
    WHERE "exchange_wallet_change".exchange_wallet_id = "exchange_wallet".id AND event_type='REFUND' 
    GROUP BY type`)
  if (refunds && refunds.length > 0) {
    refunds.forEach((item) => {
      if (item.key === 'DEMO') {
        exchangeSumary.demo.refund = item.amount
      } else if (item.key === 'MAIN') {
        exchangeSumary.main.refund = item.amount
      } else if (item.key === 'PROMOTION') {
        exchangeSumary.promotion.refund = item.amount
      }
    })
  }
  let totalIns: [GroupSumary] = await ctx.prisma
    .$queryRaw(Prisma.sql`select SUM(amount) as amount, type as key
    from "exchange_wallet", "exchange_wallet_change" 
    WHERE "exchange_wallet_change".exchange_wallet_id = "exchange_wallet".id
     AND amount > 0 AND user_id=${user_id}
    GROUP BY type`)
  if (totalIns && totalIns.length > 0) {
    totalIns.forEach((item) => {
      if (item.key === 'DEMO') {
        exchangeSumary.demo.totalIn = item.amount
      } else if (item.key === 'MAIN') {
        exchangeSumary.main.totalIn = item.amount
      } else if (item.key === 'PROMOTION') {
        exchangeSumary.promotion.totalIn = item.amount
      }
    })
  }
  let totalOuts: [GroupSumary] = await ctx.prisma
    .$queryRaw(Prisma.sql`select SUM(amount) as amount, type as key
    from "exchange_wallet", "exchange_wallet_change" 
    WHERE "exchange_wallet_change".exchange_wallet_id = "exchange_wallet".id
     AND amount < 0 AND user_id=${user_id}
    GROUP BY type`)
  if (totalOuts && totalOuts.length > 0) {
    totalOuts.forEach((item) => {
      if (item.key === 'DEMO') {
        exchangeSumary.demo.totalOut = item.amount
      } else if (item.key === 'MAIN') {
        exchangeSumary.main.totalOut = item.amount
      } else if (item.key === 'PROMOTION') {
        exchangeSumary.promotion.totalOut = item.amount
      }
    })
  }
  // get balance
  const balance = await getExchangeWalletBalance(exchangeWallet, ctx.prisma)
  exchangeSumary.main.balance = balance
  exchangeWallets = await ctx.prisma.exchangeWallet.findMany({
    where: {
      user_id,
      type: 'PROMOTION',
    },
    take: 1,
  })
  if (exchangeWallets.length > 0) {
    exchangeWallet = exchangeWallets[0]
    const balance = await getExchangeWalletBalance(exchangeWallet, ctx.prisma)
    exchangeSumary.promotion.balance = balance
  }

  return exchangeSumary
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
