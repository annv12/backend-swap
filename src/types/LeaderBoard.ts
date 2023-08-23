import { arg, enumType, extendType, objectType } from 'nexus'
const seedAgencyBoardData = require('../data/demo/agendy-leader-board.json')

export const LeaderBoard = objectType({
  name: 'LeaderBoard',
  definition: (t) => {
    t.model.id()
    t.model.user_id()
    t.model.sensored_username({ alias: 'username' })
    t.model.commission()
    t.model.win_rate()
    t.model.net_profit()
    t.model.order_count()
    t.model.f1_count()
    t.model.ref_count()
    t.model.ref_network_volume()
    t.model.f1_volume()
    t.string('bio', { nullable: true })
    t.string('avatar', { nullable: true })
    t.string('userCreatedAt', { nullable: true })
  },
})

export const LeaderboardSort = enumType({
  name: 'LeaderboardSort',
  members: ['PROFIT', 'WIN_RATE', 'REF_VOLUME', 'REF_COUNT'],
  description: 'Sort leaderboard',
})

export const LeaderBoardQuery = extendType({
  type: 'Query',
  definition: (t) => {
    t.list.field('leaderBoard', {
      type: 'LeaderBoard',
      args: {
        sort: arg({
          type: 'LeaderboardSort',
        }),
      },
      resolve: async (_, { sort }, ctx) => {
        const sortBy =
          sort === 'REF_COUNT'
            ? 'ref_count'
            : sort === 'WIN_RATE'
            ? 'win_rate'
            : sort === 'REF_VOLUME'
            ? 'ref_network_volume'
            : 'net_profit'
        const data = await ctx.prisma.leaderBoard.findMany({
          orderBy: {
            [sortBy]: 'desc',
          },
          take: 10,
        })

        const dataWithProfile = data.map(async (i: any) => {
          const profile = await ctx.prisma.userProfile.findMany({
            where: {
              user_id: i.user_id,
            },
          })

          return {
            ...i,
            bio: profile[0].bio,
            avatar: profile[0].avatar,
            userCreatedAt: profile[0].createdAt.toISOString(),
          }
        })

        return Promise.all(dataWithProfile)
      },
    })

    t.list.field('agencyBoard', {
      type: 'LeaderBoard',
      args: {},
      resolve: async (_, args, ctx) => {
        const board = await ctx.prisma.leaderBoard.findMany({
          orderBy: {
            commission: 'desc',
          },
          take: 20,
          include: {
            User: {
              include: {
                UserProfile: true,
              },
            },
          },
        })

        const dataWithBioPr = board.map((i) => {
          // const profile = await ctx.prisma.userProfile.findMany({
          //   where: {
          //     user_id: i.user_id,
          //   },
          // })

          // f1 trade volume
          // const refs = await ctx.prisma.ref.findMany({
          //   where: { sponsor_id: i.user_id },
          // })
          // const userIds = refs.map((r) => r.user_id)
          // const f1TradeVolumn = await ctx.prisma.order.aggregate({
          //   where: {
          //     user_id: {
          //       in: userIds,
          //     },
          //     account_type: 'MAIN',
          //   },
          //   sum: {
          //     bet_amount: true,
          //   },
          // })

          // return {
          //   ...i,
          //   bio: profile[0].bio,
          //   avatar: profile[0].avatar,
          //   // f1TradeVolumn: f1TradeVolumn.sum.bet_amount ?? 0,
          // }
          return {
            ...i,
            bio: i.User.UserProfile.bio,
            avatar: i.User.UserProfile.avatar,
            // f1TradeVolumn: f1TradeVolumn.sum.bet_amount ?? 0,
          }
        })
        // const result = await Promise.all(dataWithBioPr)

        // console.log('result: ', result)
        // return dataWithBioPr
        return [
          ...seedAgencyBoardData.map((i) => ({
            ...i,
            sensored_username: i.username,
          })),
          ...dataWithBioPr.filter((i) => {
            return !seedAgencyBoardData.find((s) => s.user_id === i.user_id)
          }),
        ].sort((a, b) => b.commission - a.commission)
      },
    })
  },
})
