import { objectType, extendType, stringArg, floatArg } from 'nexus'

export const ExchangePair = objectType({
  name: 'ExchangePair',
  definition: (t) => {
    t.model.id()
    t.model.createdAt()
    t.model.updatedAt()
    t.model.name()
    t.model.fee_rate()
    t.model.max_bet()
    t.model.min_bet()
    // t.model.Order()
  },
})

export const CreateExchangePair = extendType({
  type: 'Mutation',
  definition: (t) => {
    t.field('createExchangePair', {
      type: 'ExchangePair',
      args: {
        name: stringArg({ required: true }),
        max_bet: floatArg(),
        min_bet: floatArg(),
      },
      resolve: (_, { name, max_bet, min_bet }, ctx) => {
        return ctx.prisma.exchangePair.create({
          data: {
            name,
            max_bet,
            min_bet,
          },
        })
      },
    })
  },
})

export const ExchangePairQuery = extendType({
  type: 'Query',
  definition: (t) => {
    t.list.field('exchangePairs', {
      type: 'ExchangePair',
      resolve: (_, args, ctx) => {
        return ctx.prisma.exchangePair.findMany()
      },
    })
  },
})
