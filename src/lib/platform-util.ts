import { Order, PrismaClient } from '@prisma/client'
import Redis from 'ioredis'
import { getExchangeWalletBalance } from '../utils'
import math from './math'

export async function getPlatformStats(prisma: PrismaClient) {
  const orders = await prisma.order.findMany({
    where: {
      account_type: 'MAIN',
    },
    include: {
      OrderResult: true,
    },
  })

  const upOrders = orders.filter((i) => i.bet_type === 'UP')
  const downOrders = orders.filter((i) => i.bet_type === 'DOWN')

  const upOrdersVolume = calculateOrderVolume(upOrders)
  const downOrdersVolume = calculateOrderVolume(downOrders)

  const totalTradeAmount = orders.reduce((acc, curr) => {
    const sum = math.add(acc, curr.bet_amount)
    return sum.toNumber()
  }, 0)

  const winOrders = orders
    .filter((i) => i.OrderResult)
    .filter((i) => i.OrderResult.is_win || i.OrderResult.status === 'WIN')

  const loseOrders = orders
    .filter((i) => i.OrderResult)
    .filter((i) => !i.OrderResult.is_win || i.OrderResult.status === 'LOSE')

  const totalWinAmount = calculateOrderVolume(winOrders)

  const totalLoseAmount = calculateOrderVolume(loseOrders)

  const mainWalletTx = await prisma.mainWalletTransaction.findMany({
    where: { status: 'SUCCEED' },
    include: {
      Currency: true,
    },
  })
  console.log('main -> mainWalletTx', mainWalletTx.length)

  const deposit = mainWalletTx.filter((i) => i.tx_type === 'DEPOSIT')
  console.log('main -> deposit', deposit.length)
  const withdraw = mainWalletTx.filter((i) => i.tx_type === 'WITHDRAW')
  console.log('main -> withdraw', withdraw.length)

  const currencies = await prisma.currency.findMany()

  const transactions = currencies.map((currency) => {
    const depositAmount = deposit
      .filter((i) => i.Currency.id === currency.id)
      .reduce((acc, curr) => {
        return math.add(acc, curr.amount).toNumber()
      }, 0)

    const withdrawAmount = withdraw
      .filter((i) => i.Currency.id === currency.id)
      .reduce((acc, curr) => {
        return math.add(acc, curr.amount).toNumber()
      }, 0)

    return {
      depositAmount,
      withdrawAmount,
      currency: {
        id: currency.id,
        name: currency.name,
        symbol: currency.symbol,
      },
    }
  })

  // const exchangeWallets = await prisma.exchangeWallet.findMany()
  // const walletTypes = ['MAIN', 'DEMO', 'PROMOTION']

  // const groupByWallet = walletTypes.map((walletType) => {
  //   const wallet = exchangeWallets.filter((i) => i.type === walletType)
  //   return {
  //     type: walletType,
  //     wallets: wallet,
  //   }
  // })

  // const exchangeWallet = groupByWallet.map((wallet) => {
  //   const balance = getBalance(wallet.wallets)
  //   return {
  //     ...wallet,
  //     balance,
  //   }
  // })

  const result = {
    orders: {
      mainOrderCount: orders.length,
      upOrderCount: upOrders.length,
      downOrder: orders.length - upOrders.length,
      upOrdersVolume,
      downOrdersVolume,

      winOrderCount: winOrders.length,
      loseOrderCount: loseOrders.length,

      totalTradeAmount,
      totalWinAmount,
      totalLoseAmount,
    },

    transactions,
    // exchangeWallet,
  }
  return result
}

function calculateOrderVolume(orders: Order[]) {
  const result = orders.reduce((acc, curr) => {
    return math.add(acc, curr.bet_amount).toNumber()
  }, 0)

  return result
}

// async function getBalance(wallets: any) {
//   const pr = wallets.map((i: any) => {
//     return getExchangeWalletBalance(i, prisma)
//   })

//   const balance = await Promise.all(pr)
//   const totalBalance = balance.reduce((acc: number, curr: number) => {
//     return acc + curr
//   }, 0)

//   return totalBalance
// }

type PlatformBalance = {
  totalBetAmount: number
  totalWinAmount: number
  totalInSurance: number
  totalCut: number
}

export async function publishPlatformBalanceSignal(
  prisma: PrismaClient,
  publisher: Redis,
  redis: Redis,
): Promise<PlatformBalance> {
  const [totalBetAmount, totalWinAmount, totalInSurance, platformCut] =
    await Promise.all([
      prisma.order.aggregate({
        _sum: {
          bet_amount: true,
        },
      }),
      prisma.orderResult.aggregate({
        _sum: {
          win_amount: true,
        },
      }),
      prisma.insuranceTransaction.aggregate({
        _sum: {
          amount: true,
        },
      }),
      redis.get('platformCut'),
    ])

  if (isNaN(Number(platformCut))) {
    redis.set('platformCut', 0)
  }

  publisher.publish(
    'pool-info',
    JSON.stringify({
      totalBetAmount: totalBetAmount._sum.bet_amount,
      totalWinAmount: totalWinAmount._sum.win_amount,
      totalInSurance: totalInSurance._sum.amount,
      totalCut: platformCut,
    }),
  )

  return {
    totalBetAmount: totalBetAmount._sum.bet_amount,
    totalWinAmount: totalWinAmount._sum.win_amount,
    totalInSurance: totalInSurance._sum.amount,
    totalCut: Number(platformCut),
  }
}
