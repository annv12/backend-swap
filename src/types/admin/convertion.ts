import { Prisma } from '@prisma/client'
import {
  objectType,
  extendType,
  intArg,
  arg,
  stringArg,
  queryField,
  nonNull,
} from 'nexus'
import { Context } from '../../context'
export const convertionsPayload = objectType({
  name: 'ConvertionConnectionPayload',
  definition: (t) => {
    t.list.field('nodes', {
      type: 'ConvertionTransaction',
      nullable: true,
    })
    t.int('total')
  },
})

export const convertionDetail = objectType({
  name: 'ConvertionDetail',
  definition: (t) => {
    t.float('converted_amount', { nullable: true })
    t.float('amount', { nullable: true })
    t.string('symbol', { nullable: true })
  },
})

export const convertionSumaries = objectType({
  name: 'ConvertionSumaries',
  definition: (t) => {
    t.list.field('mainToExchange', {
      type: 'ConvertionDetail',
    })
    t.list.field('exchangeToMain', {
      type: 'ConvertionDetail',
    })
  },
})

export const convertionSumary = objectType({
  name: 'ConvertionSumary',
  definition: (t) => {
    t.field('mainToExchange', {
      type: 'ConvertionDetail',
    })
    t.field('exchangeToMain', {
      type: 'ConvertionDetail',
    })
  },
})

interface ConvertionSumary {
  converted_amount: number
  amount: number
  symbol: string
}

export const adConvertionQuery = extendType({
  type: 'Query',
  definition: (t) => {
    t.field('ad_convertion', {
      type: 'ConvertionConnectionPayload',
      args: {
        skip: intArg(),
        limit: intArg({ default: 10 }),
        user_id: stringArg(),
        direction: arg({ type: 'ConvertionDirection', nullable: true }),
      },
      resolve: async (parent, { skip, limit, user_id, direction }, ctx) => {
        const nodes = await ctx.prisma.convertionTransaction.findMany({
          where: {
            user_id,
            direction,
          },
          skip,
          take: limit,
          orderBy: {
            createdAt: 'desc',
          },
        })
        const total = await ctx.prisma.convertionTransaction.count({
          where: {
            user_id,
          },
        })
        return {
          nodes,
          total,
        }
      },
    })

    t.field('convertionSumary', {
      type: 'ConvertionSumaries',
      args: {
        user_id: stringArg(),
      },
      resolve: async (_, { user_id }, ctx) => {
        let results = await getConvertionSumary(ctx, user_id)
        return results
      },
    })
  },
})

export async function getConvertionSumary(ctx: Context, user_id: string) {
  const convertionMainToExchange: [ConvertionSumary] = await ctx.prisma
    .$queryRaw(Prisma.sql`select SUM("convertion_transaction".converted_amount) as converted_amount, 
    SUM(amount) as amount, "currency".symbol 
          from "convertion_transaction", "main_wallet", "exchange_wallet", "currency"
           WHERE "convertion_transaction".main_wallet_id = "main_wallet".id 
           AND "main_wallet".currency_id = "currency".id 
           AND "convertion_transaction".exchange_wallet_id = "exchange_wallet".id 
           AND direction='MAIN_TO_EXCHANGE' AND "main_wallet".user_id=${user_id} 
           GROUP BY "currency".symbol`)

  const convertionExchangeToMain: [ConvertionSumary] = await ctx.prisma
    .$queryRaw(Prisma.sql`select SUM("convertion_transaction".converted_amount) as converted_amount,
     SUM(amount) as amount, "currency".symbol 
          from "convertion_transaction", "main_wallet", "exchange_wallet", "currency"
           WHERE "convertion_transaction".main_wallet_id = "main_wallet".id 
           AND "main_wallet".currency_id = "currency".id 
           AND "convertion_transaction".exchange_wallet_id = "exchange_wallet".id 
           AND direction='EXCHANGE_TO_MAIN' AND "main_wallet".user_id=${user_id} 
           GROUP BY "currency".symbol`)
  return {
    mainToExchange: convertionMainToExchange,
    exchangeToMain: convertionExchangeToMain,
  }
}

// export const AdminConvertionCrudQuery = queryField({
//   definition(t) {
//     t.crud.user()
//     t.crud.users({
//       ordering: true,
//     })
//     t.crud.post()
//     t.crud.posts({
//       filtering: true,
//     })
//   },
// })

export const AdminConvertionPair = objectType({
  name: 'AdminConvertionPair',
  definition(t) {
    t.string('id')
    t.string('createdAt')
    t.string('updatedAt')
    t.boolean('is_enable')
    t.string('name')
    t.string('currency_id')
    t.field('Currency', { type: 'Currency' })
    t.float('buy_min_amount')
    t.float('buy_max_amount')
    t.float('buy_fee_flat')
    t.float('buy_fee_pct')
    t.float('sell_min_amount')
    t.float('sell_max_amount')
    t.float('sell_fee_flat')
    t.float('sell_fee_pct')
    t.float('max_convert_in')
    t.float('max_convert_out')
    t.float('total_convert_in')
    t.float('total_convert_out')
    t.field('ConvertionTransaction', { type: 'ConvertionTransaction' })
  },
})

export const AdminConvertionQuery = extendType({
  type: 'Query',
  definition(t) {
    t.crud.convertionPairs({
      alias: 'adminConvertionPairs',
      type: 'AdminConvertionPair',
    })
  },
})

export const AdminConvertionMutation = extendType({
  type: 'Mutation',
  definition(t) {
    t.crud.updateOneConvertionPair({
      alias: 'adminUpdateOneConvertionPair',
      type: 'AdminConvertionPair',
    })
  },
})
