import { extendType, mutationField, objectType } from 'nexus'
import {
  getPlatformStats,
  publishPlatformBalanceSignal,
} from '../../lib/platform-util'

export const PlatformStats = objectType({
  name: 'PlatformStats',
  definition: (t) => {
    t.field('orders', { type: 'Json' })
    t.field('transactions', { type: 'Json' })
    // t.field('exchangeWallet', { type: 'Json' })
  },
})

export const PlatFormQuery = extendType({
  type: 'Query',
  definition: (t) => {
    t.field('adminDashboard', {
      type: 'PlatformStats',
      resolve: async (_, args, ctx) => {
        const stats = await getPlatformStats(ctx.prisma)
        return stats
      },
    })
  },
})

export const PlatformCutMuration = mutationField((t) => {
  t.field('platformCut', {
    type: 'Float',
    args: {
      amount: 'Float',
    },
    resolve: async (_, args, ctx) => {
      await Promise.all([
        ctx.redis.set('platformCut', args.amount),
        publishPlatformBalanceSignal(ctx.prisma, ctx.pubsub, ctx.redis),
      ])
      return args.amount
    },
  })
})
