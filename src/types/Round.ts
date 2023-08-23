import { objectType, extendType, stringArg, nonNull } from 'nexus'
import { ValidationError } from '../lib/error-util'

export const Round = objectType({
  name: 'Round',
  definition: (t) => {
    t.model.id()
    t.model.createdAt()
    t.model.updatedAt()
    t.model.open_price()
    t.model.close_price()
    // t.model.close_time()
    t.model.type()
  },
})

export const DropletPayload = objectType({
  name: 'DropletPayload',
  definition: (t) => {
    t.float('date')
    t.float('open')
    t.float('high')
    t.float('low')
    t.float('close')
    t.field('type', { type: 'RoundType' })
  },
})

export const RoundQuery = extendType({
  type: 'Query',
  definition: (t) => {
    t.list.field('last100Round', {
      type: 'DropletPayload',
      args: {
        exchangePairName: nonNull(stringArg()),
      },
      resolve: async (_, args, ctx) => {
        //   const timeSeries = client
        //     .query(
        //       `
        //   select * from candle_stick
        //   order by time desc
        //   limit 100
        // `,
        //     )
        //     .then((res: any[]) => {
        //       return res.map((i: any) => ({
        //         ...i,
        //         id: i.date,
        //         type:
        //           i.close > i.open ? 'UP' : i.close < i.open ? 'DOWN' : 'BALANCE',
        //       }))
        //     })
        const exchangePair = await ctx.prisma.exchangePair.findFirst({
          where: {
            name: args.exchangePairName,
          },
        })

        if (!exchangePair) {
          throw new ValidationError(
            `Exchange pair ${args.exchangePairName} doesn't exist`,
          )
        }

        const data = await ctx.prisma.candleStick.findMany({
          where: {
            exchange_pair_id: exchangePair.id,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 100,
        })

        const timeSeries = data.map((i: any) => ({
          ...i,
          id: i.date,
          type: i.close > i.open ? 'UP' : i.close < i.open ? 'DOWN' : 'BALANCE',
        }))
        return timeSeries
      },
    })
  },
})
