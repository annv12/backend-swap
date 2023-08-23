import { objectType, extendType, intArg, arg, stringArg } from 'nexus'
import { getExpertRegisterCondition } from '../../lib/copy-trade'
import { checkPermissions } from '../../lib/auth-utils'
import { ValidationError } from '../../lib/error-util'
import { Prisma } from '@prisma/client'

export const expertPagination = objectType({
  name: 'ExpertPagination',
  definition: (t) => {
    t.list.field('nodes', {
      type: 'TradingExpertRegister',
      nullable: true,
    })
    t.int('total')
  },
})
export const expertDetail = objectType({
  name: 'ExpertDetail',
  definition: (t) => {
    t.field('expertRegistered', {
      type: 'TradingExpertRegister',
    })
    t.field('expertCondition', {
      type: 'ExpertRegisterConditionPayload',
    })
  },
})

export const adExpertQuery = extendType({
  type: 'Query',
  definition: (t) => {
    t.field('expertsReport', {
      type: 'ExpertPagination',
      args: {
        skip: intArg({ default: 0 }),
        limit: intArg({ default: 10 }),
        search: stringArg({ default: '' }),
      },
      resolve: async (_, { skip, limit, search }, ctx) => {
        let results = await ctx.prisma.$queryRaw<any>(Prisma.sql`
        select "trading_expert_register".*, "trading_expert_register".created_at as "createdAt", 
        bio, username, avatar, COUNT(*) OVER () as total
        from "trading_expert_register", "user", "user_profile"
 WHERE "user".id = "trading_expert_register".user_id AND "user".id = "user_profile".user_id
 AND (username LIKE ${`%${search}%`} OR email LIKE ${`%${search}%`})
 LIMIT ${limit} OFFSET ${skip}
                `)
        // console.log('results: ', results)
        return {
          nodes: results,
          total: results.length > 0 ? results[0].total : 0,
        }
      },
    })

    t.field('expertDetail', {
      type: 'ExpertDetail',
      args: {
        registered_id: stringArg({ required: true }),
      },
      resolve: async (_, { registered_id }, ctx) => {
        let results = await ctx.prisma.$queryRaw<any>(Prisma.sql`
                select "trading_expert_register".*, "trading_expert_register".created_at as "createdAt", bio, username, avatar
                from "trading_expert_register", "user", "user_profile"
         WHERE "user".id = "trading_expert_register".user_id AND "user".id = "user_profile".user_id
        AND "trading_expert_register".id=${registered_id}
                        `)

        const expertRegistered = results[0]
        // console.log('expertRegistered: ', expertRegistered)
        if (!expertRegistered) {
          throw new ValidationError({ message: 'Data not found' })
        }

        const expertCondition = await getExpertRegisterCondition(
          ctx.prisma,
          expertRegistered.user_id,
        )
        return {
          expertRegistered,
          expertCondition,
        }
      },
    })
  },
})

export const adExpertMut = extendType({
  type: 'Mutation',
  definition: (t) => {
    t.field('updateExpertStatus', {
      type: 'Boolean',
      args: {
        registered_id: stringArg({ required: true }),
        status: arg({
          type: 'TradingExpertRegisterStatus',
          required: true,
        }),
      },
      resolve: async (_, { registered_id, status }, ctx) => {
        if (ctx.role === 'TRADER') {
          throw new ValidationError({
            message: ctx.i18n.__("You haven't permission"),
          })
        }
        await checkPermissions(ctx, ['CAN_UPDATE_EXPERT'])
        let expertRegister = await ctx.prisma.tradingExpertRegister.findUnique({
          where: {
            id: registered_id,
          },
        })
        if (!expertRegister) {
          throw new ValidationError({
            message: ctx.i18n.__('Data not found'),
          })
        }

        await ctx.prisma.tradingExpertRegister.update({
          where: {
            id: registered_id,
          },
          data: {
            approved_status: status,
          },
        })
        return true
      },
    })
  },
})
