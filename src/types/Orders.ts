import {
  objectType,
  extendType,
  floatArg,
  inputObjectType,
  intArg,
  arg,
  stringArg,
} from 'nexus'
import {
  isEnableBetRound,
  getExchangeWalletBalance,
  sendCommissionToSponsorList,
} from '../utils'
import logger from '../lib/logger'
import { ValidationError } from '../lib/error-util'
import { getTimeID } from '../lib/round-utils'
import { Prisma } from '@prisma/client'
import { sendCommissionMessage } from '../lib/redis-queue-utils'

export const Order = objectType({
  name: 'Order',
  definition: (t) => {
    t.model.id()
    t.model.createdAt()
    t.model.updatedAt()
    t.model.account_type()
    t.model.bet_amount()
    t.model.bet_type()
    t.model.bet_time()
    t.model.exchange_pair_id()
    t.model.OrderResult()
    t.model.round_id()
    // t.field('ExchangePair', { type: 'ExchangePair' })
    t.model.ExchangePair()
    t.field('Round', {
      type: 'Round',
      resolve: async (root, arg, ctx) => {
        const round = await ctx.prisma.round.findUnique({
          where: { time_id: root.round_id },
        })
        return round
      },
    })
    t.field('RoundResult', {
      type: 'Round',
      resolve: async (root, arg, ctx) => {
        const round = await ctx.prisma.roundResult.findFirst({
          where: {
            time_id: root.round_id,
            exchange_pair_id: root.exchange_pair_id,
          },
        })
        return round
      },
    })
    t.model.User()
    t.model.copy_trade_id()
  },
})

export const OrderDemo = objectType({
  name: 'OrderDemo',
  definition: (t) => {
    t.model.id()
    t.model.createdAt()
    t.model.updatedAt()
    t.model.account_type()
    t.model.bet_amount()
    t.model.bet_type()
    t.model.bet_time()
    t.model.round_id()
    t.model.exchange_pair_id()
    t.model.OrderResultDemo()
    t.model.ExchangePair()
    // t.model.Round()
    t.field('Round', {
      type: 'Round',
      resolve: async (root, arg, ctx) => {
        const round = await ctx.prisma.round.findUnique({
          where: {
            // @ts-ignore
            time_id: root.round_id,
          },
        })
        return round
      },
    })
  },
})

export const OrderResultDemo = objectType({
  name: 'OrderResultDemo',
  definition: (t) => {
    t.model.id()
    t.model.createdAt()
    t.model.updatedAt()
    t.model.is_win()
    t.model.win_amount()
    t.model.status()
    t.model.User()
  },
})

export const OrderResult = objectType({
  name: 'OrderResult',
  definition: (t) => {
    t.model.id()
    t.model.createdAt()
    t.model.updatedAt()
    t.model.is_win()
    t.model.win_amount()
    t.model.status()
    t.model.User()
  },
})

export const OrderAggregate = objectType({
  name: 'OrderAggregate',
  definition: (t) => {
    t.int('count')
  },
})

export const CreateOrderInput = inputObjectType({
  name: 'InputType',
  definition(t) {
    t.float('bet_amount', { required: true })
    t.int('answer')
  },
})

export const createOrder = extendType({
  type: 'Mutation',
  definition: (t) => {
    t.field('createOrder', {
      type: 'Order',
      args: {
        bet_amount: floatArg({ nullable: false }),
        bet_type: arg({ type: 'BetType', required: true }),
        exchange_pair_id: stringArg({
          default: '49d5e47f-c1ee-416b-92aa-535cf5a4638d',
        }),
        account_type: arg({ type: 'AccountType', required: true }),
      },
      resolve: async (
        parent,
        { bet_amount, bet_type, exchange_pair_id, account_type },
        ctx,
      ) => {
        if (!isEnableBetRound()) {
          throw new ValidationError({
            message: ctx.i18n.__('Not in bet round, Please wait'),
          })
        }
        const currentTimestamp = new Date().getTime()
        const roundTimeID = getTimeID(currentTimestamp)

        const lock = await ctx.redlock.lock(`lock:bet:${ctx.user}`, 3000)
        const user = await ctx.prisma.user.findUnique({
          where: { id: ctx.user },
        })

        let mesErr
        let order: any
        try {
          const userWallets = await ctx.prisma.exchangeWallet.findMany({
            where: {
              user_id: ctx.user,
            },
          })

          const isDemoAccount =
            userWallets.filter((i) => i.type === 'DEMO').length > 1
          const demoMain = userWallets.sort(
            (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
          )

          const userWallet = isDemoAccount
            ? account_type === 'MAIN'
              ? demoMain[1]
              : account_type === 'DEMO'
              ? demoMain[0]
              : demoMain[2]
            : userWallets.find((i) => i.type === account_type)

          if (!userWallet) {
            throw new ValidationError({
              message: ctx.i18n.__(`Wallet not found`),
            })
          }
          if (userWallet.is_frozen) {
            throw new ValidationError({
              message: ctx.i18n.__(`Your wallet is FROZEN`),
            })
          }

          const walletBalance = await getExchangeWalletBalance(
            userWallet,
            ctx.prisma,
          )
          if (walletBalance < bet_amount) {
            throw new ValidationError({
              message: ctx.i18n.__('Your balance is not enough'),
            })
          }

          const exchangePair = await ctx.prisma.exchangePair.findUnique({
            where: { id: exchange_pair_id },
          })
          if (!exchangePair) {
            throw new ValidationError({
              message: ctx.i18n.__("Can't find exchagne pair"),
            })
          }

          const { max_bet, min_bet } = await ctx.prisma.exchangePair.findUnique(
            {
              where: {
                id: exchangePair.id,
              },
            },
          )
          if (max_bet && max_bet < bet_amount) {
            throw new ValidationError({
              message: ctx.i18n.__(
                'Amount to large max bet amount allowed is %@'.replace(
                  '%@',
                  `${max_bet}`,
                ),
              ),
            })
          }
          if (min_bet && min_bet > bet_amount) {
            throw new ValidationError({
              message: ctx.i18n.__(
                'Amount too low min bet amount allowed is %@'.replace(
                  '%@',
                  `${min_bet}`,
                ),
              ),
            })
          }

          // const rounds = await ctx.prisma.round.findMany({
          //   take: 1,
          //   orderBy: {
          //     createdAt: 'desc',
          //   },
          // })
          // const round = rounds[0]
          // if (round.close_price) {
          //   throw new ValidationError({ message: ctx.i18n.__('Round closed') })
          // }

          const orderData: Prisma.OrderCreateArgs = {
            data: {
              User: {
                connect: {
                  id: ctx.user,
                },
              },
              ExchangePair: {
                connect: {
                  id: exchangePair.id,
                },
              },
              round_id: roundTimeID,
              bet_amount,
              bet_type,
              account_type: isDemoAccount ? 'DEMO' : account_type,
              bet_time: new Date(),
            },
          }

          // if (userWallet.type === 'MAIN')
          if (userWallet.type === 'MAIN') {
            // if (isDemoAccount || account_type === 'DEMO') {
            //   order = await ctx.prisma.orderDemo.create(orderData)

            //   try {
            //     await ctx.prisma.exchangeWalletChangeDemo.create({
            //       data: {
            //         amount: -bet_amount,
            //         event_type: 'ORDER',
            //         event_id: order.id,
            //         ExchangeWallet: {
            //           connect: {
            //             id: userWallet.id,
            //           },
            //         },
            //       },
            //     })
            //     return order
            //   } catch (error) {
            //     logger.error(
            //       `Cannot create walletChange, delete order ${order.id}`,
            //     )
            //     await ctx.prisma.orderDemo.delete({
            //       where: {
            //         id: order.id,
            //       },
            //     })
            //     return error
            //   }
            // }

            order = await ctx.prisma.order.create(orderData)

            try {
              await ctx.prisma.exchangeWalletChange.create({
                data: {
                  amount: -bet_amount,
                  event_type: 'ORDER',
                  event_id: order.id,
                  ExchangeWallet: {
                    connect: {
                      id: userWallet.id,
                    },
                  },
                },
              })
            } catch (error) {
              logger.error(
                `Cannot create walletChange, delete order ${order.id}`,
              )
              await ctx.prisma.order.delete({
                where: {
                  id: order.id,
                },
              })
              return error
            }

            // send order to copyTrade service
            ctx.pubsub.publish('process-copy-trade', {
              betAmount: bet_amount,
              betType: bet_type,
              exchangePairID: exchangePair.id,
              accountType: account_type,
              userId: ctx.user,
              currentTimestamp,
              roundTimeID,
              roundId: roundTimeID,
              expertOrderId: order.id,
            })

            // const cmData = JSON.stringify({
            //   userId: ctx.user,
            //   betAmount: bet_amount,
            //   orderId: order.id,
            // })
            // sendCommissionMessage(cmData, ctx.rsmq)
            // Send commission
            // const refs = await ctx.prisma.ref.findMany({
            //   where: {
            //     user_id: ctx.user,
            //   },
            // })
            // const ref = refs[0]
            // if (ref && ref.note) {
            //   const sponsorList = ref.note as RefNote[]
            //   if (sponsorList.length > 0) {
            //     logger.info(
            //       `[x] User ${user.username} bet ${bet_amount} => Send COM to sponsorList:`,
            //       sponsorList,
            //     )
            //     sendCommissionToSponsorList(
            //       ctx.user,
            //       sponsorList,
            //       'TRADING',
            //       bet_amount,
            //       order.id,
            //       ctx.prisma,
            //     )
            //   }
            // }
          } else if (userWallet.type === 'PROMOTION') {
            order = await ctx.prisma.order.create(orderData)

            await ctx.prisma.exchangeWalletChange.create({
              data: {
                amount: -bet_amount,
                event_type: 'ORDER',
                event_id: order.id,
                ExchangeWallet: {
                  connect: {
                    id: userWallet.id,
                  },
                },
              },
            })
          } else {
            // demo type
            order = await ctx.prisma.orderDemo.create(orderData)

            try {
              await ctx.prisma.exchangeWalletChangeDemo.create({
                data: {
                  amount: -bet_amount,
                  event_type: 'ORDER',
                  event_id: order.id,
                  ExchangeWallet: {
                    connect: {
                      id: userWallet.id,
                    },
                  },
                },
              })
              return order
            } catch (error) {
              logger.error(
                `Cannot create walletChange, delete order ${order.id}`,
              )
              await ctx.prisma.orderDemo.delete({
                where: {
                  id: order.id,
                },
              })
              return error
            }

            // order = await ctx.prisma.order.create(orderData)

            // await ctx.prisma.exchangeWalletChange.create({
            //   data: {
            //     amount: -bet_amount,
            //     event_type: 'ORDER',
            //     event_id: order.id,
            //     ExchangeWallet: {
            //       connect: {
            //         id: userWallet.id,
            //       },
            //     },
            //   },
            // })
          }

          return order
        } catch (err) {
          mesErr = err
        } finally {
          lock.unlock().catch(function (err) {
            console.error('lock err: ', err)
          })
        }
        if (mesErr) {
          return mesErr
        }
        return order
      },
    })
  },
})

export const ListUserOrder = extendType({
  type: 'Query',
  definition: (t) => {
    t.list.field('userOrders', {
      type: 'Order',
      args: {
        skip: intArg(),
        limit: intArg({ default: 10 }),
        walletType: arg({ type: 'AccountType', default: 'MAIN' }),
      },
      resolve: async (parent, { skip, limit, walletType }, ctx) => {
        const userExchangeWallets = await ctx.prisma.exchangeWallet.findMany({
          where: {
            user_id: ctx.user,
          },
        })

        const isDemoAccount =
          userExchangeWallets.filter((i) => i.type === 'DEMO').length > 1

        if (isDemoAccount || walletType === 'DEMO') {
          const res = await ctx.prisma.orderDemo.findMany({
            where: {
              user_id: ctx.user,
              order_result_id: {
                not: null,
              },
            },
            skip,
            take: limit,
            orderBy: {
              createdAt: 'desc',
            },
          })

          return res
        }
        const res = await ctx.prisma.order.findMany({
          where: {
            user_id: ctx.user,
            account_type: walletType,
          },
          skip,
          take: limit,
          orderBy: {
            createdAt: 'desc',
          },
        })

        return res
      },
    })

    t.list.field('userOrdersDemo', {
      type: 'OrderDemo',
      args: {
        skip: intArg(),
        limit: intArg({ default: 10 }),
      },
      resolve: async (parent, { skip, limit }, ctx) => {
        const res: any = await ctx.prisma.orderDemo.findMany({
          where: {
            user_id: ctx.user,
          },
          skip,
          take: limit,
          orderBy: {
            createdAt: 'desc',
          },
        })

        return res
      },
    })

    t.field('orderAggreagte', {
      type: 'OrderAggregate',
      args: {
        walletType: arg({ type: 'AccountType', default: 'MAIN' }),
      },
      resolve: async (_, { walletType }, ctx) => {
        if (walletType === 'DEMO') {
          const count = await ctx.prisma.orderDemo.count({
            where: {
              user_id: ctx.user,
            },
          })
          return { count }
        }
        const count = await ctx.prisma.order.count({
          where: {
            user_id: ctx.user,
            account_type: walletType,
          },
        })
        return { count }
      },
    })
  },
})
