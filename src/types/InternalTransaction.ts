import { objectType, extendType, intArg, arg } from 'nexus'

export const InternalTransaction = objectType({
  name: 'InternalTransaction',
  definition: (t) => {
    t.model.id()
    t.model.createdAt()
    t.model.address()
    t.model.amount()
    t.model.status()
    t.model.tx_hash()
    t.model.tx_type()
    // t.model.User()
  },
})

export const InternalTransactionAggregate = objectType({
  name: 'InternalTransactionAggregate',
  definition: (t) => {
    t.int('count')
  },
})

export const internalTransactionQuery = extendType({
  type: 'Query',
  definition: (t) => {
    t.list.field('userInternalTransaction', {
      type: 'InternalTransaction',
      args: {
        skip: intArg(),
        limit: intArg(),
        type: arg({ type: 'InternalTransactionType' }),
        status: arg({ type: 'InternalTransactionStatus' }),
      },
      resolve: (_, { limit, skip, type, status }, ctx) => {
        const result = ctx.prisma.internalTransaction.findMany({
          where: {
            tx_type: type,
            status: status,
            user_id: ctx.user,
          },
          take: limit,
          skip,
          orderBy: {
            createdAt: 'desc',
          },
        })

        return result
      },
    })

    t.field('userInternalTransactionAggregate', {
      type: 'InternalTransactionAggregate',
      args: {},
      resolve: async (_, args, ctx) => {
        const count = await ctx.prisma.internalTransaction.count({
          where: {
            user_id: ctx.user,
          },
        })

        return { count }
      },
    })
  },
})
