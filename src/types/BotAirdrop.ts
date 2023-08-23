import { objectType, extendType, stringArg, intArg } from 'nexus'
import { pushNotication } from '../lib/notify-utils'
import { NotificationType } from '@prisma/client'

export const UserBotAirdrop = objectType({
  name: 'UserBotAirdrop',
  definition: (t) => {
    t.model.id()
    t.model.createdAt()
    t.model.updatedAt()
    t.model.chatId()
    t.model.firstName()
    t.model.userId()
    t.model.User()
    t.model.twitter()
    t.model.username()
    t.model.usernameV()
    t.model.balance()
    t.model.sponsorId()
    t.model.sendStatus()

    t.nullable.field('Sponsor', {
      type: UserBotAirdrop,
      async resolve(root, __, ctx) {
        return root?.sponsorId
          ? ((await ctx.prisma.userBotAirdrop.findUnique({
              where: {
                id: root.sponsorId,
              },
            })) as any)
          : null
      },
    })
    t.list.field('Ref', {
      type: UserBotAirdrop,
      async resolve(root, args, ctx) {
        return (await ctx.prisma.userBotAirdrop.findMany({
          where: {
            sponsorId: root.id,
          },
        })) as any
      },
    })
    t.field('Ref_length', {
      type: 'Int',
      async resolve(root, args, ctx) {
        return await ctx.prisma.userBotAirdrop.count({
          where: {
            sponsorId: root.id,
          },
        })
      },
    })
    // t.int("ip_count")
    t.field('ip_count', {
      type: 'Int',
      async resolve(root, args, ctx) {
        let user = await ctx.prisma.user.findFirst({
          where: {
            id: root.userId,
          },
        })
        return await ctx.prisma.user.count({
          where: {
            ip: user.ip,
          },
        })
      },
    })
  },
})

export const GiftHistory = objectType({
  name: 'GiftHistory',
  definition: (t) => {
    t.model.id()
    t.model.createdAt()
    t.model.updatedAt()
    t.model.User()
    t.model.PromotionCode()
  },
})

export const userBotAirdropMutation = extendType({
  type: 'Mutation',
  definition: (t) => {
    t.field('sendGiftCode', {
      type: 'UpdateStatusPayload',
      args: {
        userId: stringArg({ required: true }),
        promotionCodeId: stringArg({ required: true }),
      },
      resolve: async (_, { userId, promotionCodeId }, ctx) => {
        let user = await ctx.prisma.userBotAirdrop.findFirst({
          where: {
            userId,
          },
        })

        if (!user) {
          return {
            isError: true,
            message: 'User not exists',
          }
        }
        let promotionCode = await ctx.prisma.promotionCode.findFirst({
          where: {
            id: promotionCodeId,
          },
        })
        if (!promotionCode) {
          return {
            isError: true,
            message: 'Promotion code not exists',
          }
        }

        let history = await ctx.prisma.giftHistory.create({
          data: {
            userId,
            promotionCodeId,
          },
        })

        pushNotication(
          NotificationType.SEND_GIFT_CODE,
          ctx,
          'Giftcode Promotion',
          `Congratulations! You’ve been received $${
            promotionCode.amount
          } by giftcode ${promotionCode.code} expired GMT+00:00 ${new Date(
            promotionCode.expiration_date,
          )
            .toISOString()
            .replace('T', ' ')
            .replace('Z', '')}
Please access Wallet page -> Exchange Wallet -> Enter code -> Apply to earn $${
            promotionCode.amount
          }`,
        )

        await ctx.redis.publish(
          'send-gift-code',
          JSON.stringify({
            chatId: user.chatId,
            promotionCode,
          }),
        )

        return {
          isError: false,
          message: '',
        }
      },
    })

    t.field('updateStatusSend', {
      type: 'UpdateStatusPayload',
      args: {
        users: stringArg({ required: true }),
        status: intArg({ required: true }),
      },
      resolve: async (_, { users, status }, ctx) => {
        let user = await ctx.prisma.userBotAirdrop.updateMany({
          where: {
            chatId: { in: users.split(',') },
          },
          data: {
            sendStatus: status,
          },
        })
        return {
          isError: false,
          message: '',
        }
      },
    })
  },
})

export const UserBotAirdropQuery = extendType({
  type: 'Query',
  definition: (t) => {
    t.list.field('userBotAirdrop', {
      type: UserBotAirdrop,
      args: {
        skip: intArg({ required: true, default: 0 }),
        limit: intArg({ default: 20 }),
      },
      resolve: async (parent, args, ctx) => {
        return await ctx.prisma.userBotAirdrop.findMany({
          orderBy: [
            {
              User: {
                ip: 'desc',
              },
            },
            {
              createdAt: 'asc',
            },
          ],
          take: args.limit,
          skip: args.skip,
        })
      },
    })
    t.field('totalUserBotAirdrop', {
      type: 'Int',
      resolve: async (parent, _, ctx) => {
        return await ctx.prisma.userBotAirdrop.count()
      },
    })

    t.list.field('giftHistory', {
      type: GiftHistory,
      resolve: async (parent, _, ctx) => {
        return await ctx.prisma.giftHistory.findMany()
      },
    })

    t.list.field('userSend', {
      type: UserBotAirdrop,
      args: {
        status: intArg({ required: true, default: 0 }),
        limit: intArg({ default: 20 }),
      },
      resolve: async (parent, args, ctx) => {
        return await ctx.prisma.userBotAirdrop.findMany({
          where: {
            sendStatus: args.status,
          },
          skip: 0,
          take: args.limit,
        })
      },
    })
  },
})
