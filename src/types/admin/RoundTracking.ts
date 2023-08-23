import { extendType, objectType, stringArg } from 'nexus'

export const OrderWithBetPercent = objectType({
  name: 'OrderWithBetPercent',
  definition: (t) => {
    t.string('id')
    t.string('createdAt')
    t.string('updatedAt')
    t.string('account_type')
    t.string('bet_time')
    t.float('bet_amount')
    t.string('bet_type')
    t.float('betPercent', { nullable: true })
    t.field('User', { type: 'User' })
    t.field('OrderResult', { type: 'OrderResult' })
  },
})

export const RoundTracking = objectType({
  name: 'AdminRoundTracking',
  definition: (t) => {
    t.string('id')
    t.string('type')
    t.int('time_id')
    t.list.field('Order', {
      type: 'Order',
      args: {
        exchangePairId: stringArg()
      },
      resolve: async (root, arg, ctx) => {
        const orders = await ctx.prisma.order.findMany({
          where: {
            round_id: root.time_id + 2,
            exchange_pair_id: arg.exchangePairId,
          },
          include: {
            User: true,
            OrderResult: true,
          }
        })
        return orders
      },
    })
  },
})

export const roudTracking = extendType({
  type: 'Query',
  definition: (t) => {
    t.list.field('roundTracking', {
      type: 'AdminRoundTracking',
      resolve: async (_, args, ctx) => {
        const trackingRound = await ctx.prisma.round.findMany({
          orderBy: {
            createdAt: 'desc',
          },
          take: 2,
          // include: {
          //   Order: {
          //     include: {
          //       OrderResult: true,
          //       User: true,
          //     },
          //   },
          // },
        })

        return trackingRound
      },
    })
  },
})
