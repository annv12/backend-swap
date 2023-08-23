import { objectType, extendType, arg, intArg } from 'nexus'

import logger from '../lib/logger'
import { getTimeID } from '../lib/round-utils'
import { Order, OrderDemo } from './Orders'
import { Prisma, CopyTradeStatus, AccountType } from '@prisma/client'

const maxRound = parseInt(process.env.MAX_ROUND_INSURANCE) || 6

export const UserInsurance = objectType({
  name: 'UserInsurance',
  definition: (t) => {
    t.model.id()
    t.model.user_id()
    t.model.round()
    t.model.round_start()
    t.model.time_start()
    t.model.account_type()
    t.boolean('is_enable')
    t.model.InsuranceTransaction()
    t.model.insurance_trader_id()
    t.model.InsuranceTrader()
    t.model.InsuranceCopyer()
  },
})

const RoundInfo = objectType({
  name: 'RoundInfo',
  definition: (t) => {
    t.float('profit')
    t.string('status')
    t.field('time', {
      type: 'DateTime',
    })
    t.list.field('orders', {
      type: Order,
    })
    t.list.field('orderDemo', {
      type: OrderDemo,
    })
  },
})

export const Insurance = objectType({
  name: 'Insurance',
  definition: (t) => {
    t.field('date', {
      type: 'DateTime',
    })
    t.float('invest')
    t.float('round')
    t.float('insurance')
    t.boolean('is_enable')
    t.list.field('rounds', {
      type: RoundInfo,
    })
  },
})

export const InsuranceTransaction = objectType({
  name: 'InsuranceTransaction',
  definition: (t) => {
    t.model.id()
    t.model.amount()
    t.model.account_type()
    t.model.UserInsurance()
  },
})

type CopyTradeInfo = {
  copier_id: string
  status: CopyTradeStatus
}

export const createOrUpdateInsurance = extendType({
  type: 'Mutation',
  definition: (t) => {
    t.field('updateInsurance', {
      type: 'UserInsurance',
      args: {
        status: arg({ type: 'Boolean', required: true }),
        accountType: arg({ type: 'AccountType', required: true }),
      },
      resolve: async (parent, { status, accountType }, ctx) => {
        try {
          // console.log("🚀 ~ file: Insurance.ts:53 ~ ctx.user", ctx.user)
          console.time('query-data')
          let [info, copiers] = await Promise.all([
            ctx.prisma.userInsurance.findFirst({
              where: {
                user_id: ctx.user,
                is_enable: true,
                account_type: accountType,
                insurance_trader_id: null,
              },
            }),
            ctx.prisma.$queryRaw<CopyTradeInfo[]>(Prisma.sql`
	SELECT
		copy_trade.copier_id,
		copy_trade.status
	FROM
		copy_trade
		RIGHT JOIN (
			SELECT
				user_id,
				approved_status
			FROM
				trading_expert_register
			WHERE
				trading_expert_register.approved_status = 'APPROVED'
				AND trading_expert_register.user_id = ${ctx.user}) ter ON copy_trade.trader_id = ter.user_id

	WHERE
		copy_trade.status = 'START'
    `),
          ])
          // console.log("🚀 ~ file: Insurance.ts:60 ~ info", info)
          let dataUpdate = {
            is_enable: status,
            round: status ? maxRound : 0,
            account_type: accountType,
          }
          if (info && info.is_enable) {
            ;[info] = await Promise.all([
              ctx.prisma.userInsurance.update({
                where: { id: info.id },
                data: dataUpdate,
              }),
              ctx.prisma.userInsurance.updateMany({
                where: {
                  insurance_trader_id: info.id,
                  account_type: AccountType.MAIN,
                },
                data: dataUpdate,
              }),
            ])
          } else if (status) {
            info = await ctx.prisma.userInsurance.create({
              data: {
                is_enable: status,
                round: maxRound,
                account_type: accountType,
                User: {
                  connect: {
                    id: ctx.user,
                  },
                },
                round_start: getTimeID(new Date().getTime()),
                time_start: new Date(),
              },
            })

            // create insurance for copier
            if (accountType == AccountType.MAIN) {
              await Promise.all(
                copiers.map(
                  async (copier) =>
                    await ctx.prisma.userInsurance.create({
                      data: {
                        is_enable: status,
                        round: maxRound,
                        account_type: accountType,
                        user_id: copier.copier_id,
                        insurance_trader_id: info.id,
                        round_start: getTimeID(new Date().getTime()),
                        time_start: new Date(),
                      },
                    }),
                ),
              )
            }
          }
          // send insurance info
          ctx.pubsub.publish('insurance-info', {
            is_enable: info?.is_enable || false,
            round: info?.round || 0,
          })
          return info
        } catch (error) {
          logger.error(`Cannot create data in table UserInsurance`)
          return error
        }
      },
    })
  },
})

// userInsurances: isAuthAndHealthy,
export const UserInsuranceInfo = extendType({
  type: 'Query',
  definition: (t) => {
    t.field('userInsuranceInfo', {
      type: 'UserInsurance',
      args: {
        accountType: arg({ type: 'AccountType', required: true }),
      },
      resolve: async (parent, { accountType }, ctx) => {
        try {
          let data = await ctx.prisma.userInsurance.findFirst({
            where: {
              user_id: ctx.user,
              account_type: accountType,
              insurance_trader_id: null,
            },
            orderBy: {
              createdAt: 'desc',
            },
          })
          // console.log("🚀 ~ file: Insurance.ts:159 ~ data", data)
          if (!data) {
            return {
              is_enable: false,
              round: 0,
            }
          }
          return data
        } catch (error) {
          logger.error(`Cannot create data in table UserInsurance`)
          return error
        }
      },
    })
  },
})

export const ListUserInsurance = extendType({
  type: 'Query',
  definition: (t) => {
    t.list.field('userInsurances', {
      type: 'Insurance',
      args: {
        skip: intArg(),
        limit: intArg({ default: 10 }),
        walletType: arg({ type: 'AccountType', default: 'MAIN' }),
      },
      resolve: async (parent, { skip, limit, walletType }, ctx) => {
        // console.time('get history insurance')
        let res = await ctx.prisma.userInsurance.findMany({
          where: {
            user_id: ctx.user,
            account_type: walletType,
          },
          include: {
            HistoryInsurance: {
              include: {
                Order: {
                  include: {
                    OrderResult: true,
                  },
                  orderBy: {
                    createdAt: 'desc',
                  },
                },
                OrderDemo: {
                  include: {
                    OrderResultDemo: true,
                  },
                  orderBy: {
                    createdAt: 'desc',
                  },
                },
              },
              orderBy: {
                createdAt: 'desc',
              },
            },
            InsuranceTransaction: true,
          },
          skip,
          take: limit,
          orderBy: {
            time_start: 'desc',
          },
        })
        // console.log("🚀 ~ file: Insurance.ts:199 ~ resolve: ~ res", res)
        let data = res
          .filter((item) => item.is_enable || item.HistoryInsurance.length > 0)
          .map((item) => {
            return {
              date: item.time_start,
              invest: item.HistoryInsurance.reduce(
                (totalBet, round) => totalBet + round.total_bet,
                0,
              ),
              round: item.round,
              insurance: item.InsuranceTransaction
                ? item.InsuranceTransaction.amount
                : 0,
              is_enable: item.is_enable,
              rounds: item.HistoryInsurance.map((round) => ({
                time: round.createdAt,
                profit: round.total_win - round.total_bet,
                status:
                  round.total_win > round.total_bet
                    ? 'WIN'
                    : round.total_win < round.total_bet
                    ? 'LOSE'
                    : 'DRAW',
                orders: round.Order.filter(
                  (order) => order.account_type === walletType,
                ),
                orderDemo: round.OrderDemo.filter(
                  (order) => order.account_type === walletType,
                ),
              })),
            }
          })
        // console.timeEnd('get history insurance')
        return data
      },
    })
  },
})
