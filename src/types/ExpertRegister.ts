import { arg, enumType, extendType, intArg, objectType, stringArg } from 'nexus'
import { Prisma } from '@prisma/client'
import { getExpertRegisterCondition } from '../lib/copy-trade'
import { ValidationError } from '../lib/error-util'
const expertDemoData = require('../data/demo/exp.json')

export const ExpertRegisterConditionPayload = objectType({
  name: 'ExpertRegisterConditionPayload',
  definition: (t) => {
    t.float('winRate')
    t.int('tradeCountXDayAgo')
    t.float('profitWithinXDayAgo')
    t.float('volumeWithinXDayAgo')
  },
})

export const TradingExpertRegister = objectType({
  name: 'TradingExpertRegister',
  definition: (t) => {
    t.model.id()
    t.model.user_id()
    t.model.createdAt()
    t.model.approved_status()
    t.string('username')
    t.string('bio', { nullable: true })
    t.float('net_profit', { nullable: true })
    t.float('win_rate', { nullable: true })
    t.string('avatar', { nullable: true })
    t.int('copiers', { nullable: true })
  },
})

export const ExpertSort = enumType({
  name: 'ExpertSort',
  members: ['PROFIT', 'WIN_RATE', 'COPIER'],
  description: 'SORT EXPERT',
})

export const ExpertActiveStatus = enumType({
  name: 'ExpertActiveStatus',
  members: ['APPROVED', 'PAUSE'],
  description: 'Expert active status',
})

export const ExpertRegisterQuery = extendType({
  type: 'Query',
  definition: (t) => {
    t.field('expertRegisterCondition', {
      type: 'ExpertRegisterConditionPayload',
      resolve: async (_, arg, ctx) => {
        const result = await getExpertRegisterCondition(ctx.prisma, ctx.user)
        return result
      },
    })

    t.list.field('experts', {
      type: 'TradingExpertRegister',
      args: {
        skip: intArg({ default: 0 }),
        limit: intArg({ default: 10 }),
        search: stringArg({ default: '' }),
        sort: arg({
          type: 'ExpertSort',
        }),
      },
      resolve: async (_, { skip, limit, search, sort }, ctx) => {
        const sortBy =
          sort === 'WIN_RATE'
            ? 'ORDER BY win_rate ASC'
            : sort === 'COPIER'
            ? 'ORDER BY copiers ASC'
            : 'ORDER BY net_profit ASC'

        console.time('query-experts')
        let results = await ctx.prisma.$queryRaw<any>(Prisma.sql`
        SELECT
          trading_expert_register.id,
          trading_expert_register.user_id,
          trading_expert_register.approved_status,
          user_profile.avatar,
          "user".username,
          "user".email,
          user_profile.bio,
          od.total_bet_amount,
          odr.total_win_amount,
          COALESCE(odr.total_win_amount, 0.0) - COALESCE(od.total_bet_amount, 0.0) AS net_profit,
          odr.bet_count,
          odr.win_count,
          (odr.win_count / odr.bet_count) * 100.0 AS win_rate,
          cpt.total_copier as copiers
        FROM
          trading_expert_register
          LEFT JOIN (
            SELECT
              user_id,
              sum(win_amount) AS total_win_amount,
              count(id) AS bet_count,
              sum(
                CASE WHEN status = 'WIN' THEN
                  1.0
                ELSE
                  0.0
                END) AS win_count
            FROM
              order_result
            WHERE
              created_at > '2019-11-1'
            GROUP BY
              user_id) odr ON trading_expert_register.user_id = odr.user_id
          LEFT JOIN (
            SELECT
              user_id,
              sum(bet_amount) AS total_bet_amount
            FROM
              "order"
            WHERE
              created_at > '2019-11-1'
            GROUP BY
              user_id) od ON od.user_id = trading_expert_register.user_id
          LEFT JOIN (
            SELECT
              trader_id,
              count(id) total_copier
            FROM
              copy_trade
            GROUP BY
              trader_id) cpt ON cpt.trader_id = trading_expert_register.user_id
          LEFT JOIN user_profile ON trading_expert_register.user_id = user_profile.user_id
          LEFT JOIN "user" ON "user".id = trading_expert_register.user_id
        WHERE
          (username LIKE ${`%${search}%`} OR email LIKE ${`%${search}%`}) AND (approved_status = 'APPROVED'
          OR approved_status = 'PAUSE')
        ${
          sort === 'WIN_RATE'
            ? Prisma.sql`ORDER BY win_rate DESC`
            : sort === 'COPIER'
            ? Prisma.sql`ORDER BY copiers DESC`
            : Prisma.sql`ORDER BY net_profit DESC`
        }
        LIMIT ${limit} OFFSET ${skip}
                `)
        console.timeEnd('query-experts')

        return [
          ...expertDemoData,
          ...results.filter((i) => {
            return !expertDemoData.find((j) => j.username === i.username)
          }),
        ].sort((a, b) => {
          if (sort === 'WIN_RATE') {
            return b.win_rate - a.win_rate
          } else if (sort === 'COPIER') {
            return b.copiers - a.copiers
          } else {
            return b.net_profit - a.net_profit
          }
        })
      },
    })

    t.field('expertsAggregate', {
      type: 'PaginationCount',
      args: {
        search: stringArg({ default: '' }),
      },
      resolve: async (_, { search }, ctx) => {
        const count = await ctx.prisma.tradingExpertRegister.count({
          where: {
            approved_status: {
              in: ['APPROVED', 'PAUSE'],
            },
            User: {
              OR: [
                {
                  username: {
                    contains: search,
                  },
                },
                {
                  email: {
                    contains: search,
                  },
                },
              ],
            },
          },
        })
        return { count }
      },
    })
  },
})

export const ExpertRegisterMutation = extendType({
  type: 'Mutation',
  definition: (t) => {
    t.field('updateExpertActiveStatus', {
      type: 'Boolean',
      args: {
        status: arg({
          type: 'ExpertActiveStatus',
          nullable: false,
        }),
      },
      resolve: async (_, { status }, ctx) => {
        let expertRegister = await ctx.prisma.tradingExpertRegister.findUnique({
          where: {
            user_id: ctx.user,
          },
        })
        if (!expertRegister) {
          throw new ValidationError({
            message: ctx.i18n.__('You not an expert'),
          })
        }
        if (
          expertRegister.approved_status !== 'APPROVED' &&
          expertRegister.approved_status !== 'PAUSE'
        ) {
          throw new ValidationError({
            message: ctx.i18n.__('You not an expert'),
          })
        }

        await ctx.prisma.tradingExpertRegister.update({
          where: {
            user_id: ctx.user,
          },
          data: {
            approved_status: status,
          },
        })
        return true
      },
    })

    t.field('submitExpertregistration', {
      type: 'Boolean',
      resolve: async (_, args, ctx) => {
        // check is expert
        const expertRegistered =
          await ctx.prisma.tradingExpertRegister.findUnique({
            where: {
              user_id: ctx.user,
            },
          })
        if (expertRegistered) {
          throw new ValidationError({ message: 'You already submit request' })
        }

        const condition = await getExpertRegisterCondition(ctx.prisma, ctx.user)

        if (condition.tradeCountXDayAgo < 10) {
          throw new ValidationError({ message: 'Condition not meet' })
        }

        if (condition.profitWithinXDayAgo < 200) {
          throw new ValidationError({ message: 'Condition not meet' })
        }

        if (condition.volumeWithinXDayAgo < 1000) {
          throw new ValidationError({ message: 'Condition not meet' })
        }
        if (condition.winRate < 50) {
          throw new ValidationError({ message: 'Condition not meet' })
        }
        await ctx.prisma.tradingExpertRegister.create({
          data: {
            User: {
              connect: {
                id: ctx.user,
              },
            },
            approved_status: 'PENDING',
          },
        })

        return true
      },
    })
  },
})
