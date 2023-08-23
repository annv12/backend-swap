import { extendType, intArg, objectType, stringArg } from 'nexus'

export const TradeBattleArena = objectType({
  name: 'TradeBattleArena',
  definition: (t) => {
    t.string('username')
    t.string('user_id')
    t.list.field('orders', { type: 'Order' })
    t.list.field('wallets', { type: 'ExchangeWallet' })
  },
})

export const TradeBattleArenaQuery = extendType({
  type: 'Query',
  definition: (t) => {
    t.list.field('tradeBattleArena', {
      type: 'TradeBattleArena',
      args: {
        tournamentId: stringArg({ required: true }),
      },
      resolve: async (_, { tournamentId }, ctx) => {
        const list = await ctx.prisma.tournamentTransaction.findMany({
          where: {
            tournament_id: tournamentId,
          },
        })

        const arenaData = list.map(async (i) => {
          const user = await ctx.prisma.user.findUnique({
            where: { id: i.user_id },
          })
          const lastRounds = await ctx.prisma.round.findMany({
            orderBy: {
              createdAt: 'desc',
            },
            take: 1,
          })
          const lastRound = lastRounds[0]

          const orders = await ctx.prisma.order.findMany({
            where: {
              // round_id: lastRound.id,
              user_id: user.id,
              account_type: 'MAIN',
            },
          })

          const exchangeWallet = await ctx.prisma.exchangeWallet.findMany({
            where: {
              user_id: i.user_id,
            },
          })

          return {
            ...i,
            username: user.username,
            orders: orders,
            wallets: exchangeWallet,
          }
        })

        return Promise.all(arenaData)
      },
    })
  },
})
