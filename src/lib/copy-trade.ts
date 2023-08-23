import { PrismaClient } from '@prisma/client'

export async function getExpertRegisterCondition(
  prisma: PrismaClient,
  user_id: string,
) {
  const priorDate = new Date(new Date().setDate(new Date().getDate() - 7))

  const tradeAmountXDayAgo = await prisma.order.aggregate({
    where: {
      user_id: user_id,
      createdAt: {
        gt: priorDate,
      },
    },
    _sum: {
      bet_amount: true,
    },
  })
  const winAmountXDayAgo = await prisma.orderResult.aggregate({
    where: {
      Order: {
        user_id: user_id,
        account_type: {
          not: 'DEMO',
        },
        createdAt: {
          gt: priorDate,
        },
      },
    },
    _sum: {
      win_amount: true,
    },
  })

  const profitXDayAgo =
    winAmountXDayAgo._sum.win_amount - tradeAmountXDayAgo._sum.bet_amount

  const tradeCountXDayAgo = await prisma.order.count({
    where: {
      user_id: user_id,
      account_type: 'MAIN',
      createdAt: {
        gt: priorDate,
      },
    },
  })
  let winRate = 0
  const leaderboard = await prisma.leaderBoard.findUnique({
    where: {
      user_id: user_id,
    },
  })
  const cacheTime = leaderboard?.cache_time

  // const cacheTime = leaderboard.cache_time
  // const userExchangeWallets = await prisma.exchangeWallet.findMany({
  //   where: {
  //     user_id: user_id,
  //     type: 'MAIN',
  //   },
  // })
  const totalOrdersCount = await prisma.order.count({
    where: {
      user_id: user_id,
      createdAt: {
        gt: cacheTime,
      },
      account_type: 'MAIN',
    },
  })
  const winOrderCount = await prisma.order.count({
    where: {
      user_id: user_id,
      createdAt: {
        gt: cacheTime,
      },
      account_type: 'MAIN',
      OrderResult: {
        status: 'WIN',
      },
    },
  })
  // const ref_txs = await prisma.refTransaction.aggregate({
  //   where: {
  //     sponsor_id: user_id,
  //   },
  //   sum: {
  //     earned: true,
  //   },
  // })
  // const totalCommission = ref_txs.sum.earned ?? 0

  winRate =
    (((leaderboard?.win_count ?? 0) + winOrderCount) /
      ((leaderboard?.order_count ?? 0) + totalOrdersCount)) *
    100
  if (isNaN(winRate)) winRate = 0

  return {
    winRate,
    tradeCountXDayAgo: tradeCountXDayAgo,
    profitWithinXDayAgo: profitXDayAgo,
    volumeWithinXDayAgo: tradeAmountXDayAgo._sum.bet_amount,
  }
}
