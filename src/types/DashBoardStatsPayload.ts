import { objectType } from 'nexus'

export const dashboardStatsPayload = objectType({
  name: 'DashBoardStatsPayload',
  definition: (t) => {
    t.float('totalTradeAmount')
    t.int('totalTrade')
    t.int('winRound')
    t.int('loseRound')
    t.int('drawRound')
    t.float('porfolioBalance')
    t.float('netProfit')
    t.float('totalRevenue')
    t.float('exchangeWalletIn')
    t.float('exchangeWalletOut')
    t.float('totalRevenueCalculated')
  },
})
