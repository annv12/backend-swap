import { extendType, objectType, stringArg } from 'nexus'
// import { getUserStats } from '../../jobs/leaderboard-job'

export const AdminPorfolio = objectType({
  name: 'AdminPorfolio',
  definition: (t) => {
    t.string('user_id')
    t.string('username')
    t.string('email')
    t.int('order_count')
    t.int('win_count')
    t.int('lose_count')
    t.float('win_rate')
    t.float('net_profit')
    t.float('trade_amount')
    t.float('win_amount')
    t.float('lose_amount')
    t.float('commission')
    t.field('main_wallets', { type: 'Json' })
    t.field('exchange_wallets', { type: 'Json' })
    t.field('tx_by_wallet', { type: 'Json' })
    t.field('transfer', { type: 'Json' })
    t.int('ref_count')
    t.int('f1_count')
  },
})

export const AdminUserQuery = extendType({
  type: 'Query',
  definition: (t) => {
    t.list.field('searchUser', {
      type: 'User',
      args: {
        username: stringArg({ required: true }),
      },
      resolve: async (_, args, ctx) => {
        const users = await ctx.prisma.user.findMany({
          where: {
            username: {
              contains: args.username,
            },
          },
        })

        return users
      },
    })

    // t.field('porfolio', {
    //   type: 'AdminPorfolio',
    //   args: {
    //     username: stringArg({ required: true }),
    //   },
    //   resolve: async (_, { username }, ctx) => {
    //     const user = await ctx.prisma.user.findUnique({
    //       where: { username: username },
    //     })
    //     const result = await getUserStats(user)
    //     // console.log('result', result)
    //     return result
    //   },
    // })
  },
})
