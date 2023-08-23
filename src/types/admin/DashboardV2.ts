import { extendType, objectType } from 'nexus'
import { add, sub } from '../../lib/math'
import { formatNumber } from '../../lib/utils'

export const DashboardTypeV2 = objectType({
  name: 'DashboardTypeV2',
  definition(t) {
    t.int('totalUser')
    t.float('totalDepositAmount')
    t.float('totalWidthdrawAmount')
    t.float('totalAccountBalance')
    t.float('totalOrder')
    t.float('totalOrderAmount')
    t.float('totalProfit')
    t.float('totalCommission')
  },
})

export const Dashboard = extendType({
  type: 'Query',
  definition(t) {
    t.field('dashboardStatsV2', {
      type: 'DashboardTypeV2',
      resolve: async (_, args, ctx) => {
        const totalUser = await ctx.prisma.user.count()

        // total deposit
        const totalReceive = await ctx.prisma.internalTransaction.aggregate({
          where: {
            tx_type: 'RECEIVE',
          },
          _sum: {
            amount: true,
          },
        })
        const totalDepositConverted =
          await ctx.prisma.convertionTransaction.aggregate({
            where: {
              AND: [
                { direction: 'MAIN_TO_EXCHANGE' },
                {
                  OR: [
                    { MainWallet: { Currency: { symbol: 'USDT' } } },
                    { MainWallet: { Currency: { symbol: 'TBR' } } },
                  ],
                },
              ],
            },
            _sum: {
              converted_amount: true,
            },
          })

        const totalDepositAmount = add(
          totalReceive._sum.amount,
          totalDepositConverted._sum.converted_amount,
        )

        // total widthdraw
        const totalSend = await ctx.prisma.internalTransaction.aggregate({
          where: {
            tx_type: 'SEND',
          },
          _sum: { amount: true },
        })

        const totalWidthdrawConverted =
          await ctx.prisma.convertionTransaction.aggregate({
            where: {
              AND: [
                { direction: 'EXCHANGE_TO_MAIN' },
                {
                  OR: [
                    { MainWallet: { Currency: { symbol: 'USDT' } } },
                    { MainWallet: { Currency: { symbol: 'TBR' } } },
                  ],
                },
              ],
            },
            _sum: {
              converted_amount: true,
            },
          })
        const totalWidthdrawAmount = add(
          totalSend._sum.amount,
          totalWidthdrawConverted._sum.converted_amount,
        )

        // total amount in live account
        const mainExchangeWallets = await ctx.prisma.exchangeWallet.findMany({
          where: { type: 'MAIN' },
        })
        const mainExchangeWalletIds = mainExchangeWallets.map(
          (wallet) => wallet.id,
        )
        const totalAccount = await ctx.prisma.exchangeWalletChange.aggregate({
          where: {
            exchange_wallet_id: { in: mainExchangeWalletIds },
          },
          _sum: { amount: true },
        })
        const totalAccountBalance = totalAccount._sum.amount

        // total order
        const totalOrder = await ctx.prisma.order.count()

        // total order amount
        const totalOrderAggregate = await ctx.prisma.order.aggregate({
          _sum: { bet_amount: true },
        })
        const totalOrderAmount = totalOrderAggregate._sum.bet_amount

        // total profit
        const totalProfit = add(
          Number(totalWidthdrawAmount),
          Number(sub(totalAccountBalance, Number(totalDepositAmount))),
        )

        // total commision
        const refTransactions = await ctx.prisma.refTransaction.aggregate({
          _sum: { earned: true },
        })
        const totalCommission = refTransactions._sum.earned

        return {
          totalUser,
          totalDepositAmount: Number(totalDepositAmount),
          totalWidthdrawAmount: Number(totalWidthdrawAmount),
          totalAccountBalance: Number(totalAccountBalance),
          totalOrder,
          totalOrderAmount,
          totalProfit: Number(totalProfit),
          totalCommission,
        }
      },
    })
  },
})
