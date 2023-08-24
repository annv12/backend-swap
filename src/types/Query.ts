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
        })
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
