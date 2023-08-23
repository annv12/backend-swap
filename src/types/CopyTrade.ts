import {
  objectType,
  stringArg,
  extendType,
  booleanArg,
  intArg,
  floatArg,
  arg,
} from 'nexus'
import * as math from '../lib/math'
import { ValidationError } from '../lib/error-util'
import { getExchangeWalletBalance } from '../utils'
import { pushNotication } from '../lib/notify-utils'
import { format } from 'date-fns'
import { Prisma } from '@prisma/client'

export const CopyTrade = objectType({
  name: 'CopyTrade',
  definition(t) {
    t.model.id()
    t.model.createdAt()
    t.model.amount()
    t.model.remain()
    t.model.percent_per_trade()
    t.model.max_amount_per_trade()
    t.model.fixed_amount_per_trade()
    t.model.stop_loss()
    t.model.take_profit()
    t.model.profit_sharing()
    t.model.copier_id()
    t.model.Copier()
    t.model.status()
    t.model.trader_id()
    t.model.Trader()
    // t.model.Order()
    t.float('earned', { nullable: true })
    t.float('profit', { nullable: true })
    t.float('invested', { nullable: true })
    t.int('totalTrades', { nullable: true })
  },
})

export const CopyTradeCommissionHistory = objectType({
  name: 'CopyTradeCommissionHistory',
  definition(t) {
    t.model.id()
    t.model.createdAt()
    t.model.time()
    t.model.copier_id()
    t.model.expert_id()
    t.model.total_order()
    t.model.win_order()
    t.model.volume()
    t.model.profit()
    t.model.commission()
    t.model.User()
  },
})

export const CopyTradeAction = objectType({
  name: 'CopyTradeAction',
  definition(t) {
    t.model.id()
    t.model.createdAt()
    t.model.amount()
    t.model.extra_data()
    t.model.status()
    t.model.copy_trade_id()
    t.model.CopyTrade()
  },
})

export const CopyTradeLeaderSumary = objectType({
  name: 'CopyTradeLeaderSummary',
  definition: (t) => {
    t.float('earned', { nullable: true })
    t.float('funds', { nullable: true })
    t.int('copier', { nullable: true })
    t.int('activeCopier', { nullable: true })
    t.float('avgInvestment', { nullable: true })
    t.string('avatar', { nullable: true })
    t.float('profitSharing', { nullable: true })
    t.string('createdAt', { nullable: true })

    t.float('profit', { nullable: true })
    t.float('winRate', { nullable: true })
    t.int('copiedBid', { nullable: true })
  },
})
export const CopyTradeCopierSumary = objectType({
  name: 'CopyTradeCopierSummary',
  definition: (t) => {
    t.float('profit', { nullable: true })
    t.float('invested', { nullable: true })
    t.int('copying', { nullable: true })
  },
})

export const copyTradeQuery = extendType({
  type: 'Query',
  definition: (t) => {
    t.list.field('copyTradeActions', {
      type: 'CopyTradeAction',
      args: {
        isCopier: booleanArg({ default: true }),
        skip: intArg(),
        limit: intArg({ default: 10 }),
      },
      resolve: async (_, { isCopier, limit, skip }, ctx) => {
        const res = await ctx.prisma.copyTradeAction.findMany({
          where: {
            CopyTrade: {
              [isCopier ? 'Copier' : 'Trader']: {
                id: ctx.user,
              },
            },
          },
          take: limit,
          skip,
          orderBy: {
            createdAt: 'desc',
          },
        })
        return res
      },
    })

    t.field('copyTradeActionsAggregate', {
      type: 'PaginationCount',
      args: {
        isCopier: booleanArg({ default: true }),
      },
      resolve: async (_, { isCopier }, ctx) => {
        const count = await ctx.prisma.copyTradeAction.count({
          where: {
            CopyTrade: {
              [isCopier ? 'Copier' : 'Trader']: {
                id: ctx.user,
              },
            },
          },
        })
        return { count }
      },
    })

    t.list.field('copyTrades', {
      type: 'CopyTrade',
      args: {
        isCopier: booleanArg({ default: true }),
        skip: intArg(),
        limit: intArg({ default: 10 }),
      },
      resolve: async (_, { isCopier, limit, skip }, ctx) => {
        const copyTrades = await ctx.prisma.copyTrade.findMany({
          where: {
            [isCopier ? 'copier_id' : 'trader_id']: ctx.user,
          },
          take: limit,
          skip,
        })
        for (let item of copyTrades) {
          if (!isCopier) {
            const results = await Promise.all([
              ctx.prisma.order.aggregate({
                where: {
                  copy_trade_id: item.id,
                },
                _sum: {
                  bet_amount: true,
                },
              }),
              ctx.prisma.orderResult.aggregate({
                where: {
                  Order: {
                    copy_trade_id: item.id,
                  },
                },
                _sum: {
                  win_amount: true,
                },
              }),
              ctx.prisma.order.count({
                where: {
                  copy_trade_id: item.id,
                },
              }),
            ])
            // @ts-ignore
            item['invested'] = results[0].sum.bet_amount
            // @ts-ignore
            item['earned'] = results[1].sum.win_amount
            // @ts-ignore
            item['totalTrades'] = results[2]
          } else {
            const results = await Promise.all([
              ctx.prisma.order.aggregate({
                where: {
                  copy_trade_id: item.id,
                },
                _sum: {
                  bet_amount: true,
                },
              }),
              ctx.prisma.orderResult.aggregate({
                where: {
                  Order: {
                    copy_trade_id: item.id,
                  },
                },
                _sum: {
                  win_amount: true,
                },
              }),
              ctx.prisma.order.count({
                where: {
                  copy_trade_id: item.id,
                },
              }),
            ])
            const invested = results[0]._sum.bet_amount
            const revenue = results[1]._sum.win_amount
            // @ts-ignore
            item['profit'] = revenue - invested
            // @ts-ignore
            item['invested'] = invested
            // @ts-ignore
            item['totalTrades'] = results[2]
          }
        }

        return copyTrades
      },
    })

    t.field('copyTradesAggregate', {
      type: 'PaginationCount',
      args: {
        isCopier: booleanArg({ default: true }),
      },
      resolve: async (_, { isCopier }, ctx) => {
        const count = await ctx.prisma.copyTrade.count({
          where: {
            [isCopier ? 'copier_id' : 'trader_id']: ctx.user,
          },
        })
        return { count }
      },
    })

    t.field('copyTrade', {
      type: 'CopyTrade',
      args: {
        copyTradeId: stringArg({ required: true }),
      },
      resolve: async (_, { copyTradeId }, ctx) => {
        const copyTrade = await ctx.prisma.copyTrade.findUnique({
          where: {
            id: copyTradeId,
          },
        })
        if (
          copyTrade.copier_id !== ctx.user &&
          copyTrade.trader_id !== ctx.user
        ) {
          throw new ValidationError({
            message: ctx.i18n.__('You not have permission'),
          })
        }

        return copyTrade
      },
    })

    t.list.field('copyTradeOrders', {
      type: 'Order',
      args: {
        copyTradeId: stringArg({ required: true }),
        skip: intArg(),
        limit: intArg({ default: 10 }),
      },
      resolve: async (_, { limit, skip, copyTradeId }, ctx) => {
        const orders = await ctx.prisma.order.findMany({
          where: {
            copy_trade_id: copyTradeId,
          },
          take: limit,
          skip: skip,
          orderBy: {
            createdAt: 'desc',
          },
        })

        return orders
      },
    })

    t.field('copyTradeOrdersAggregate', {
      type: 'PaginationCount',
      args: {
        copyTradeId: stringArg({ required: true }),
      },
      resolve: async (_, { copyTradeId }, ctx) => {
        const count = await ctx.prisma.order.count({
          where: {
            copy_trade_id: copyTradeId,
          },
        })

        return { count }
      },
    })

    t.field('copyTradeLeaderSummary', {
      type: 'CopyTradeLeaderSummary',
      args: {
        user_id: stringArg({ nullable: true }),
      },
      resolve: async (_, { user_id }, ctx) => {
        let userID = user_id ?? ctx.user
        let expertWallets = await ctx.prisma.exchangeWallet.findMany({
          where: {
            user_id: userID,
            type: 'MAIN',
          },
        })
        const expertWalletId = expertWallets[0].id
        let promisResult = await Promise.all([
          // 0 get earned of leader
          ctx.prisma.exchangeWalletChange.aggregate({
            where: {
              exchange_wallet_id: expertWalletId,
              event_type: 'COPY_TRADE_COMISSION',
            },
            _sum: {
              amount: true,
            },
          }),
          //1 total funds of leader
          ctx.prisma.order.aggregate({
            where: {
              CopyTrade: {
                trader_id: userID,
              },
            },
            _sum: {
              bet_amount: true,
            },
          }),
          // 2 total copier of leader
          ctx.prisma.copyTrade.count({
            where: {
              trader_id: userID,
            },
          }),
          // 3 total active copier of leader
          ctx.prisma.copyTrade.count({
            where: {
              status: 'START',
              trader_id: ctx.user,
            },
          }),
          // 4 avg per order (last 30 order)
          ctx.prisma.order.aggregate({
            orderBy: {
              createdAt: 'desc',
            },
            take: 30,
            where: {
              CopyTrade: {
                trader_id: userID,
              },
            },
            _avg: {
              bet_amount: true,
            },
          }),
          //5 leader profile
          ctx.prisma.userProfile.findUnique({
            where: {
              user_id: userID,
            },
          }),
          // 6 copiedBid
          ctx.prisma.order.count({
            where: {
              CopyTrade: {
                trader_id: userID,
              },
            },
          }),
          // 7 get leaderboard to get winrate, profit...
          ctx.prisma.$queryRaw<any>(Prisma.sql`
          SELECT (SELECT (SUM(CASE WHEN win_amount > 0 THEN 1.0 ELSE 0.0 END) / SUM(1.0))*100.0 
          FROM order_result WHERE user_id = ${userID}) AS win_rate,
          (SELECT SUM( CASE WHEN win_amount > 0 THEN win_amount ELSE	0.0 END) - SUM(bet_amount)
                FROM order_result, "order"
                WHERE
                    order_result.id = "order".order_result_id
                    AND order_result.user_id = ${userID}) AS net_profit`),
        ])
        // console.log('promisResult[7]: ', promisResult[7])
        return {
          earned: promisResult[0]._sum.amount ?? 0,
          funds: promisResult[1]._sum.bet_amount ?? 0,
          copier: promisResult[2] ?? 0,
          activeCopier: promisResult[3] ?? 0,
          avgInvestment: promisResult[4]._avg.bet_amount ?? 0,
          avatar: promisResult[5].avatar,
          profitSharing: promisResult[5].profit_sharing ?? 0,
          createdAt: promisResult[5].createdAt.toISOString(),
          copiedBid: promisResult[6],
          profit: promisResult[7][0]?.net_profit ?? 0,
          winRate: promisResult[7][0]?.win_rate ?? 0,
        }
      },
    })

    t.field('copyTradeCopierSummary', {
      type: 'CopyTradeCopierSummary',
      resolve: async (_, arg, ctx) => {
        let promisResult = await Promise.all([
          //0 revenue
          ctx.prisma.orderResult.aggregate({
            where: {
              Order: {
                CopyTrade: {
                  Copier: {
                    id: ctx.user,
                  },
                },
              },
              win_amount: {
                gt: 0,
              },
              // user_id: ctx.user,
            },
            _sum: {
              win_amount: true,
            },
          }),
          //1 get total bet(invested)
          ctx.prisma.order.aggregate({
            where: {
              CopyTrade: {
                Copier: {
                  id: ctx.user,
                },
              },
            },
            _sum: {
              bet_amount: true,
            },
          }),
          // 2 total copying of current copier
          ctx.prisma.copyTrade.count({
            where: {
              status: 'START',
              copier_id: ctx.user,
            },
          }),
        ])

        const revenue = promisResult[0]._sum.win_amount ?? 0
        const invested = promisResult[1]._sum.bet_amount ?? 0
        return {
          profit: revenue - invested,
          invested,
          copying: promisResult[2] ?? 0,
        }
      },
    })

    t.list.field('copyTradeCommissions', {
      type: 'CopyTradeCommissionHistory',
      args: {
        skip: intArg(),
        limit: intArg({ default: 10 }),
      },
      resolve: async (_, { skip, limit }, ctx) => {
        let commissionHistories = await ctx.prisma.copyTradeCommissionHistory.findMany(
          {
            where: {
              expert_id: ctx.user,
            },
            take: limit,
            skip,
            orderBy: {
              time: 'desc',
            },
          },
        )

        return commissionHistories
      },
    })
    t.field('copyTradeCommissionsAggregate', {
      type: 'PaginationCount',
      resolve: async (_, arg, ctx) => {
        const count = await ctx.prisma.copyTradeCommissionHistory.count({
          where: {
            expert_id: ctx.user,
          },
        })

        return { count }
      },
    })
  },
})

export const copyTradeMut = extendType({
  type: 'Mutation',
  definition: (t) => {
    t.field('createCopyTrade', {
      type: 'CopyTrade',
      args: {
        amount: floatArg({ nullable: false }),
        percentPerTrade: floatArg({ nullable: true }),
        maxAmountPerTrade: floatArg({ nullable: true }),
        fixedAmountPerTrade: floatArg({ nullable: true }),
        stopLoss: floatArg({ nullable: true }),
        takeProfit: floatArg({ nullable: true }),
        trader_id: stringArg({ required: true }),
      },
      resolve: async (
        _,
        {
          trader_id,
          amount,
          percentPerTrade,
          maxAmountPerTrade,
          fixedAmountPerTrade,
          stopLoss,
          takeProfit,
        },
        ctx,
      ) => {
        if (trader_id === ctx.user) {
          throw new ValidationError({
            message: ctx.i18n.__("You can't copy yourself"),
          })
        }
        // check exist copy trade
        const existCopyTrades = await ctx.prisma.copyTrade.findMany({
          where: {
            copier_id: ctx.user,
            trader_id: trader_id,
          },
          take: 1,
        })
        if (existCopyTrades && existCopyTrades.length > 0) {
          throw new ValidationError({
            message: ctx.i18n.__("You can't copy this trader more"),
          })
        }
        // check trader is expert user was registered
        let experts = await ctx.prisma.tradingExpertRegister.findMany({
          where: {
            user_id: trader_id,
            OR: [
              {
                approved_status: 'APPROVED',
              },
              {
                approved_status: 'PAUSE',
              },
            ],
          },
        })
        if (!experts || experts.length === 0) {
          throw new ValidationError({
            message: ctx.i18n.__('Trader is not expert'),
          })
        }
        // check buy plan and is valid
        // let subscriptions = await ctx.prisma.serviceSubscription.findMany({
        //   where: {
        //     user_id: ctx.user,
        //     end_time: {
        //       gt: new Date(),
        //     },
        //   },
        // })
        // if (!subscriptions || subscriptions.length === 0) {
        //   throw new ValidationError({
        //     message: ctx.i18n.__('Please upgrade your plan to continue'),
        //   })
        // }

        let traderProfile = await ctx.prisma.userProfile.findUnique({
          where: {
            user_id: trader_id,
          },
        })
        if (!traderProfile) {
          throw new ValidationError({
            message: ctx.i18n.__('Leader profile not found'),
          })
        }
        // check configed profit sharing
        if (traderProfile.profit_sharing == null) {
          throw new ValidationError({
            message: ctx.i18n.__("Trader haven't configured profit sharing"),
          })
        }
        if (
          traderProfile.profit_sharing > 1 ||
          traderProfile.profit_sharing <= 0
        ) {
          throw new ValidationError({
            message: ctx.i18n.__('Profit sharing not valid'),
          })
        }
        // check balance
        let exchangeWallets = await ctx.prisma.exchangeWallet.findMany({
          where: {
            user_id: ctx.user,
            type: 'MAIN',
          },
          take: 1,
        })
        if (!exchangeWallets || exchangeWallets.length === 0) {
          throw new ValidationError({
            message: ctx.i18n.__('Exchange wallet not found'),
          })
        }
        let exchangeWallet = exchangeWallets[0]
        let balance = await getExchangeWalletBalance(exchangeWallet, ctx.prisma)
        if (balance < 0) {
          throw new ValidationError({
            message: ctx.i18n.__('Balance not enough'),
          })
        }
        if (amount <= 0) {
          throw new ValidationError({
            message: ctx.i18n.__('Amount must greater than 0'),
          })
        }
        if (balance < amount) {
          throw new ValidationError({
            message: ctx.i18n.__('Balance not enough'),
          })
        }
        let minBet = 1
        // get config bet
        const exchangePairs = await ctx.prisma.exchangePair.findMany({
          take: 1,
        })
        if (exchangePairs && exchangePairs.length > 0) {
          minBet = exchangePairs[0].min_bet
        }

        if (
          (percentPerTrade == null || maxAmountPerTrade == null) &&
          fixedAmountPerTrade == null
        ) {
          throw new ValidationError({
            message: ctx.i18n.__('Please enter valid data'),
          })
        }
        if (percentPerTrade <= 0 || percentPerTrade > 1) {
          throw new ValidationError({
            message: ctx.i18n.__('Copy percent amount per trade not valid'),
          })
        }
        if (maxAmountPerTrade > amount) {
          throw new ValidationError({
            message: ctx.i18n.__(
              'Maximal investment per copied trade must lower than or equal investment amount',
            ),
          })
        }
        if (fixedAmountPerTrade != null && fixedAmountPerTrade > amount) {
          throw new ValidationError({
            message: ctx.i18n.__(
              `Fixed amount per trade cannot be greater than investment amount`,
            ),
          })
        }
        if (fixedAmountPerTrade != null && fixedAmountPerTrade < minBet) {
          throw new ValidationError({
            message: ctx.i18n.__(`Min trade amount is ${minBet}`),
          })
        }
        if (maxAmountPerTrade < minBet) {
          throw new ValidationError({
            message: ctx.i18n.__(`Min trade amount is ${minBet}`),
          })
        }
        if (stopLoss != null && (stopLoss < 0 || stopLoss >= 1)) {
          throw new ValidationError({
            message: ctx.i18n.__('Stop loss value not valid'),
          })
        }
        if (takeProfit != null && (takeProfit <= 1 || takeProfit > 10)) {
          throw new ValidationError({
            message: ctx.i18n.__('Take profit value not valid'),
          })
        }
        const copyTrade = await ctx.prisma.copyTrade.create({
          data: {
            Copier: {
              connect: {
                id: ctx.user,
              },
            },
            Trader: {
              connect: {
                id: trader_id,
              },
            },
            amount,
            remain: amount,
            percent_per_trade: percentPerTrade,
            max_amount_per_trade: maxAmountPerTrade,
            fixed_amount_per_trade: fixedAmountPerTrade,
            stop_loss: stopLoss,
            take_profit: takeProfit,
            profit_sharing: traderProfile.profit_sharing,
          },
        })
        // create action history
        await ctx.prisma.copyTradeAction.create({
          data: {
            status: 'START',
            extra_data: {
              ...(copyTrade as any),
            },
            CopyTrade: {
              connect: {
                id: copyTrade.id,
              },
            },
          },
        })
        let expertInfo = await ctx.prisma.user.findUnique({
          where: {
            id: copyTrade.trader_id,
          },
        })
        let copierInfo = await ctx.prisma.user.findUnique({
          where: {
            id: copyTrade.copier_id,
          },
        })
        pushNotication(
          'COPYING',
          ctx,
          `You are copying [${expertInfo.username}]`,
          `You have completed copying orders from expert known as [${
            expertInfo.username
          }] at [${format(new Date(), 'HH:mm, dd/MM/yyyy')}]
          
If this activity is not your own, please contact us immediately.`,
        )
        ctx.pubsub?.publish(`create-copytrade`, {
          user: copierInfo.username,
          trader: expertInfo.username,
          copyTrade
        })
        return copyTrade
      },
    })

    t.field('updateCopyTrade', {
      type: 'CopyTrade',
      args: {
        copyTradeId: stringArg({ required: true }),
        amount: floatArg(),
        percentPerTrade: floatArg({ nullable: true }),
        maxAmountPerTrade: floatArg({ nullable: true }),
        fixedAmountPerTrade: floatArg({ nullable: true }),
        stopLoss: floatArg({ nullable: true }),
        takeProfit: floatArg({ nullable: true }),
        status: arg({ type: 'CopyTradeStatus', nullable: true }),
      },
      resolve: async (
        _,
        {
          copyTradeId,
          amount,
          percentPerTrade,
          maxAmountPerTrade,
          fixedAmountPerTrade,
          stopLoss,
          takeProfit,
          status,
        },
        ctx,
      ) => {
        const copyTrade = await ctx.prisma.copyTrade.findUnique({
          where: {
            id: copyTradeId,
          },
          include: {
            Copier: true,
            Trader: true,
          }
        })
        if (copyTrade == null) {
          throw new ValidationError({
            message: ctx.i18n.__('Copy trade not found'),
          })
        }
        if (copyTrade.copier_id !== ctx.user) {
          throw new ValidationError({
            message: ctx.i18n.__('You not have permission'),
          })
        }
        if (copyTrade.status === status) {
          throw new ValidationError({
            message: ctx.i18n.__("Can't update with same status"),
          })
        }

        // check if is update one of three setting
        const isUpdateTradeAmount =
          percentPerTrade != null ||
          maxAmountPerTrade != null ||
          fixedAmountPerTrade != null

        if (
          isUpdateTradeAmount &&
          (percentPerTrade == null || maxAmountPerTrade == null) &&
          fixedAmountPerTrade == null
        ) {
          throw new ValidationError({
            message: ctx.i18n.__(
              'Please enter Fix amount per trade or percent volume per trade and maximal investment per copied trade',
            ),
          })
        }
        if (
          percentPerTrade != null &&
          (percentPerTrade <= 0 || percentPerTrade > 1)
        ) {
          throw new ValidationError({
            message: ctx.i18n.__('Copy percent amount per trade not valid'),
          })
        }
        if (fixedAmountPerTrade != null && fixedAmountPerTrade > amount) {
          throw new ValidationError({
            message: ctx.i18n.__(
              `Fixed amount per trade cannot be greater than investment amount`,
            ),
          })
        }

        let minBet: number = 1
        // get config bet
        const exchangePairs = await ctx.prisma.exchangePair.findMany({
          take: 1,
        })
        if (exchangePairs && exchangePairs.length > 0) {
          minBet = exchangePairs[0].min_bet
        }
        if (fixedAmountPerTrade != null && fixedAmountPerTrade < minBet) {
          throw new ValidationError({
            message: ctx.i18n.__(`Min trade amount is ${minBet}`),
          })
        }
        if (maxAmountPerTrade != null && maxAmountPerTrade < minBet) {
          throw new ValidationError({
            message: ctx.i18n.__(`Min trade amount is ${minBet}`),
          })
        }

        if (stopLoss != null && (stopLoss < 0 || stopLoss >= 1)) {
          throw new ValidationError({
            message: ctx.i18n.__('Stop loss value not valid'),
          })
        }
        if (takeProfit != null && takeProfit <= 1) {
          throw new ValidationError({
            message: ctx.i18n.__('Take profit value not valid'),
          })
        }

        if (
          amount != null &&
          amount !== copyTrade.amount &&
          copyTrade.status !== 'STOP'
        ) {
          throw new ValidationError({
            message: ctx.i18n.__("Can't update amount with current status"),
          })
        }
        let profitSharing
        const amountUpdated = amount ?? copyTrade.amount
        const remainUpdated =
          copyTrade.status === 'STOP' && status === 'START'
            ? amountUpdated
            : undefined
        if (copyTrade.status === 'STOP') {
          if (status === 'PAUSE') {
            throw new ValidationError({
              message: ctx.i18n.__('Status not valid'),
            })
          }
          if (status === 'START') {
            // check trader is expert user was registered
            let experts = await ctx.prisma.tradingExpertRegister.findMany({
              where: {
                user_id: copyTrade.trader_id,
                OR: [
                  {
                    approved_status: 'APPROVED',
                  },
                  {
                    approved_status: 'PAUSE',
                  },
                ],
              },
            })
            if (!experts || experts.length === 0) {
              throw new ValidationError({
                message: ctx.i18n.__('Trader is not expert'),
              })
            }
            // check buy plan and is valid
            // let subscriptions = await ctx.prisma.serviceSubscription.findMany({
            //   where: {
            //     user_id: ctx.user,
            //     end_time: {
            //       gt: new Date(),
            //     },
            //   },
            // })

            // if (!subscriptions || subscriptions.length === 0) {
            //   throw new ValidationError({
            //     message: ctx.i18n.__('Please upgrade your plan to continue'),
            //   })
            // }
            // new copy trade, update new profit sharing
            let traderProfile = await ctx.prisma.userProfile.findUnique({
              where: {
                user_id: copyTrade.trader_id,
              },
            })
            if (!traderProfile) {
              throw new ValidationError({
                message: ctx.i18n.__('User profile not found'),
              })
            }
            // check configed profit sharing
            if (traderProfile.profit_sharing == null) {
              throw new ValidationError({
                message: ctx.i18n.__(
                  "Trader haven't configured profit sharing",
                ),
              })
            }
            profitSharing = traderProfile.profit_sharing
            if (profitSharing > 1 || profitSharing <= 0) {
              throw new ValidationError({
                message: ctx.i18n.__('Profit sharing not valid'),
              })
            }
          }
          // check balance
          let exchangeWallets = await ctx.prisma.exchangeWallet.findMany({
            where: {
              user_id: ctx.user,
              type: 'MAIN',
            },
            take: 1,
          })
          if (!exchangeWallets || exchangeWallets.length === 0) {
            throw new ValidationError({
              message: ctx.i18n.__('Exchange wallet not found'),
            })
          }
          let exchangeWallet = exchangeWallets[0]
          let balance = await getExchangeWalletBalance(
            exchangeWallet,
            ctx.prisma,
          )
          if (balance < 0) {
            throw new ValidationError({
              message: ctx.i18n.__('Balance not enough'),
            })
          }

          // check amount
          if (amountUpdated != null) {
            if (amountUpdated < 0) {
              throw new ValidationError({
                message: ctx.i18n.__('Amount must greater than 0'),
              })
            }
            if (balance < amountUpdated) {
              throw new ValidationError({
                message: ctx.i18n.__('Balance not enough'),
              })
            }
          }
        }

        if (
          (maxAmountPerTrade != null && maxAmountPerTrade > amountUpdated) ||
          (fixedAmountPerTrade != null && fixedAmountPerTrade > amountUpdated)
        ) {
          throw new ValidationError({
            message: ctx.i18n.__(
              'Maximal investment per copied trade must lower than or equal investment amount',
            ),
          })
        }

        // console.log('updateAmount: ', updateAmount)
        const updatedCopyTrade = await ctx.prisma.copyTrade.update({
          data: {
            amount: amountUpdated,
            remain: remainUpdated,
            percent_per_trade:
              fixedAmountPerTrade != null ? null : percentPerTrade,
            max_amount_per_trade:
              fixedAmountPerTrade != null ? null : maxAmountPerTrade,
            fixed_amount_per_trade:
              fixedAmountPerTrade != null
                ? fixedAmountPerTrade
                : percentPerTrade != null
                ? null
                : undefined,
            stop_loss: stopLoss,
            take_profit: takeProfit,
            profit_sharing: profitSharing,
            status: status,
          },
          where: {
            id: copyTradeId,
          },
        })
        if (status != null && status !== copyTrade.status) {
          // create action history
          await ctx.prisma.copyTradeAction.create({
            data: {
              status,
              extra_data: {
                ...(updatedCopyTrade as any),
              },
              CopyTrade: {
                connect: {
                  id: copyTradeId,
                },
              },
            },
          })
          if (status === 'START') {
            let expertInfo = await ctx.prisma.user.findUnique({
              where: {
                id: copyTrade.trader_id,
              },
            })
            pushNotication(
              'COPYING',
              ctx,
              `You are copying [${expertInfo.username}]`,
              `You have completed copying orders from expert known as [${
                expertInfo.username
              }] at [${format(new Date(), 'HH:mm, dd/MM/yyyy')}]

If this activity is not your own, please contact us immediately.`,
            )
          }
        }
        await ctx.pubsub?.publish('update-copytrade', {
          user: copyTrade.Copier.username,
          trader: copyTrade.Trader.username,
          status:
            updatedCopyTrade.status != copyTrade.status
              ? `status: ${copyTrade.status} => ${updatedCopyTrade.status}`
              : '',
          amount:
            updatedCopyTrade.amount != copyTrade.amount
              ? `amount: ${copyTrade.amount} => ${updatedCopyTrade.amount}`
              : '',
          remain:
            updatedCopyTrade.remain != copyTrade.remain
              ? `remain: ${copyTrade.remain} => ${updatedCopyTrade.remain}`
              : '',
          stopLoss:
            updatedCopyTrade.stop_loss != copyTrade.stop_loss
              ? `stopLoss: ${copyTrade.stop_loss * 100}% => ${
                  updatedCopyTrade.stop_loss * 100
                }%`
              : '',
          takeProfit:
            updatedCopyTrade.take_profit != copyTrade.take_profit
              ? `takeProfit: ${copyTrade.take_profit * 100}% => ${
                  updatedCopyTrade.take_profit * 100
                }%`
              : '',
          profit_sharing:
            updatedCopyTrade.profit_sharing != copyTrade.profit_sharing
              ? `profitSharing: ${copyTrade.profit_sharing} => ${updatedCopyTrade.profit_sharing}`
              : '',
          percent_per_trade:
            updatedCopyTrade.percent_per_trade != copyTrade.percent_per_trade
              ? `percent_per_trade: ${copyTrade.percent_per_trade} => ${updatedCopyTrade.percent_per_trade}`
              : '',
          max_amount_per_trade:
            updatedCopyTrade.max_amount_per_trade !=
            copyTrade.max_amount_per_trade
              ? `max_amount_per_trade: ${copyTrade.max_amount_per_trade} => ${updatedCopyTrade.max_amount_per_trade}`
              : '',
          fixed_amount_per_trade:
            updatedCopyTrade.fixed_amount_per_trade !=
            copyTrade.fixed_amount_per_trade
              ? `fixed_amount_per_trade: ${copyTrade.fixed_amount_per_trade} => ${updatedCopyTrade.fixed_amount_per_trade}`
              : '',
        })
        return updatedCopyTrade
      },
    })

    t.field('adjustCopyTrade', {
      type: 'CopyTrade',
      args: {
        copyTradeId: stringArg({ required: true }),
        amount: floatArg({ required: true }),
      },
      resolve: async (_, { copyTradeId, amount }, ctx) => {
        if (ctx.role !== 'TRADER') {
          throw new ValidationError({
            message: ctx.i18n.__('Only trader can copy trade'),
          })
        }
        let copyTrade = await ctx.prisma.copyTrade.findUnique({
          where: {
            id: copyTradeId,
          },
        })
        if (copyTrade == null) {
          throw new ValidationError({
            message: ctx.i18n.__('Copy trade not found'),
          })
        }
        if (copyTrade.copier_id !== ctx.user) {
          throw new ValidationError({
            message: ctx.i18n.__("You can't adjust this copy trade"),
          })
        }

        // check balance
        let exchangeWallets = await ctx.prisma.exchangeWallet.findMany({
          where: {
            user_id: ctx.user,
            type: 'MAIN',
          },
          take: 1,
        })
        if (!exchangeWallets || exchangeWallets.length === 0) {
          throw new ValidationError({
            message: ctx.i18n.__('Exchange wallet not found'),
          })
        }
        let exchangeWallet = exchangeWallets[0]
        let balance = await getExchangeWalletBalance(exchangeWallet, ctx.prisma)
        if (balance < 0) {
          throw new ValidationError({
            message: ctx.i18n.__('Balance not enough'),
          })
        }
        if (amount < 0) {
          throw new ValidationError({
            message: ctx.i18n.__('Amount must greater than 0'),
          })
        }
        let remain = math.add(copyTrade.remain ?? 0, amount).toNumber()
        if (balance < remain) {
          throw new ValidationError({
            message: ctx.i18n.__('Balance not enough'),
          })
        }

        // update amount, remain of copy trade
        let newAmount = math.add(copyTrade.amount ?? 0, amount).toNumber()
        copyTrade = await ctx.prisma.copyTrade.update({
          where: {
            id: copyTradeId,
          },
          data: {
            amount: newAmount,
            remain,
          },
        })
        // create action history
        await ctx.prisma.copyTradeAction.create({
          data: {
            amount: amount,
            status: 'ADJUST',
            extra_data: {
              ...(copyTrade as any),
            },
            CopyTrade: {
              connect: {
                id: copyTradeId,
              },
            },
          },
        })
        return copyTrade
      },
    })
  },
})
