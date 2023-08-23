import { objectType, queryType } from 'nexus'
import { getExchangeWalletBalance } from '../utils'
import * as math from './../lib/math'

export const PaginationCount = objectType({
  name: 'PaginationCount',
  definition: (t) => {
    t.int('count')
  },
})

export const Query = queryType({
  definition(t) {
    t.crud.currencies({
      alias: 'adminCurrencies',
      type: 'AdminCurrency',
    })

    t.field('me', {
      type: 'User',
      nullable: true,
      resolve: (parent, args, ctx) => {
        return ctx.prisma.user.findUnique({
          where: {
            id: ctx.user,
          },
        });
      },
    })

    t.field('dashboardStats', {
      type: 'DashBoardStatsPayload',
      resolve: async (_, args, ctx) => {
        const userExchangeWallets = await ctx.prisma.exchangeWallet.findMany({
          where: {
            user_id: ctx.user,
          },
        })

        const isDemoAccount =
          userExchangeWallets.filter((i) => i.type === 'DEMO').length > 1
        const demoMain = userExchangeWallets.sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        )

        const userLiveWallet = isDemoAccount
          ? demoMain[1]
          : userExchangeWallets.find((i) => i.type === 'MAIN')

        const userOrders = await ctx.prisma.order.findMany({
          where: {
            user_id: ctx.user,
            account_type: isDemoAccount ? 'DEMO' : 'MAIN',
          },
          include: {
            OrderResult: true,
          },
        })

        const winRound = await ctx.prisma.order.count({
          where: {
            user_id: ctx.user,
            account_type: isDemoAccount ? 'DEMO' : 'MAIN',
            OrderResult: {
              status: 'WIN',
            },
          },
        })

        const loseRound = await ctx.prisma.order.count({
          where: {
            user_id: ctx.user,
            account_type: isDemoAccount ? 'DEMO' : 'MAIN',
            OrderResult: {
              status: 'LOSE',
            },
          },
        })

        const drawRound = await ctx.prisma.order.count({
          where: {
            user_id: ctx.user,
            account_type: isDemoAccount ? 'DEMO' : 'MAIN',
            OrderResult: {
              status: 'DRAW',
            },
          },
        })

        let totalTradeAmount = 0
        if (isDemoAccount) {
          const tradeQTY = await ctx.prisma.orderDemo.aggregate({
            where: {
              user_id: ctx.user,
            },
            _sum: {
              bet_amount: true,
            },
          })
          totalTradeAmount = tradeQTY._sum.bet_amount ?? 0
        } else {
          const tradeQTY = await ctx.prisma.order.aggregate({
            where: {
              user_id: ctx.user,
              account_type: {
                not: 'DEMO',
              },
            },
            _sum: {
              bet_amount: true,
            },
          })
          totalTradeAmount = tradeQTY._sum.bet_amount ?? 0
        }

        let totalRevenue = 0
        if (isDemoAccount) {
          const orderResults =
            await ctx.prisma.exchangeWalletChangeDemo.aggregate({
              where: {
                event_type: 'ORDER_RESULT',
                exchange_wallet_id: userLiveWallet.id,
                amount: {
                  gt: 0,
                },
                ExchangeWallet: {
                  id: userLiveWallet.id,
                },
              },
              _sum: {
                amount: true,
              },
            })
          totalRevenue = orderResults._sum.amount ?? 0
        } else {
          const orderResults = await ctx.prisma.exchangeWalletChange.aggregate({
            where: {
              event_type: 'ORDER_RESULT',
              amount: {
                gt: 0,
              },
              // exchange_wallet_id: userLiveWallet.id,
              ExchangeWallet: {
                // id: userLiveWallet.id,
                user_id: ctx.user,
                type: {
                  not: 'DEMO',
                },
              },
            },
            _sum: {
              amount: true,
            },
          })
          totalRevenue = orderResults._sum.amount ?? 0
        }

        const porfolioBalance = userLiveWallet
          ? await getExchangeWalletBalance(userLiveWallet, ctx.prisma)
          : 0

        const netProfilt = totalRevenue - totalTradeAmount

        const filterExchangeWalletWithdraw =
          ctx.prisma.convertionTransaction.aggregate({
            where: {
              user_id: ctx.user,
              direction: 'EXCHANGE_TO_MAIN',
            },
            _sum: {
              amount: true,
            },
          })

        const filterExchangeWalletDeposit =
          ctx.prisma.convertionTransaction.aggregate({
            where: {
              user_id: ctx.user,
              direction: 'MAIN_TO_EXCHANGE',
            },
            _sum: {
              amount: true,
            },
          })

        const filterExchangeWalletSend =
          ctx.prisma.internalTransaction.aggregate({
            where: {
              user_id: ctx.user,
              status: 'SUCCEED',
              tx_type: 'SEND',
            },
            _sum: {
              amount: true,
            },
          })

        const filterExchangeWalletReceive =
          ctx.prisma.internalTransaction.aggregate({
            where: {
              user_id: ctx.user,
              status: 'SUCCEED',
              tx_type: 'RECEIVE',
            },
            _sum: {
              amount: true,
            },
          })

        const [
          totalWithdrawExchangeWallet,
          totalDepositExchangeWallet,
          totalSendExchangeWallet,
          totalReceiveExchangeWallet,
        ] = await ctx.prisma.$transaction([
          filterExchangeWalletWithdraw,
          filterExchangeWalletDeposit,
          filterExchangeWalletSend,
          filterExchangeWalletReceive,
        ])

        const exchangeWalletIn = math.add(
          totalDepositExchangeWallet._sum.amount ?? 0,
          totalReceiveExchangeWallet._sum.amount ?? 0,
        )

        const exchangeWalletOut = math.add(
          totalWithdrawExchangeWallet._sum.amount ?? 0,
          totalSendExchangeWallet._sum.amount ?? 0,
        )

        const totalPorfolioBalanceWithExchangeWalletOut = math.add(
          porfolioBalance,
          Number(exchangeWalletOut),
        )

        const totalRevenueCalculated = math.sub(
          Number(totalPorfolioBalanceWithExchangeWalletOut),
          Number(exchangeWalletIn),
        )

        return {
          totalTradeAmount,
          totalTrade: userOrders.length,
          winRound,
          loseRound,
          drawRound,
          porfolioBalance,
          netProfit: netProfilt <= 0 ? 0 : netProfilt,
          totalRevenue,
          exchangeWalletIn: Number(exchangeWalletIn),
          exchangeWalletOut: Number(exchangeWalletOut),
          totalRevenueCalculated: Number(totalRevenueCalculated),
        }
      },
    })

    t.field('version', {
      type: 'String',
      resolve: (parent, args, ctx) => {
        return '1.0.0'
      },
    })
  },
})
