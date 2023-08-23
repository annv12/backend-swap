import {
  objectType,
  extendType,
  arg,
  stringArg,
  subscriptionField,
  nonNull,
  intArg,
} from 'nexus'

export const candleStickPayload = objectType({
  name: 'CandleStickPayload',
  definition: (t) => {
    t.float('date')
    t.float('open')
    t.float('high')
    t.float('low')
    t.float('close')
    t.float('volume')
    t.boolean('f')
    t.int('round_time_id')
  },
})

export const OrderByCandleStickQuery = extendType({
  type: 'Query',
  definition: (t) => {
    t.list.field('candleStickHistory', {
      type: 'CandleStickPayload',
      args: {
        exchangePairId: stringArg(),
      },
      resolve: async (_, args, ctx) => {
        const timeSeries = await ctx.prisma.candleStick.findMany({
          where: {
            exchange_pair_id: args.exchangePairId || "49d5e47f-c1ee-416b-92aa-535cf5a4638d",
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 100,
        })

        return timeSeries
      },
    })
  },
})

export const candleStickSubscription = subscriptionField('candleStickv2', {
  type: 'CandleStickPayload',
  args: {
    exchangePairName: nonNull(stringArg()),
  },
  subscribe: async (_, args, ctx) => {
    return ctx.pubsub.asyncIterator(`candlestick.${args.exchangePairName}`)
  },
  // @ts-ignore
  resolve(payload) {
    if (payload) return payload
  },
})
