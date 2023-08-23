import { booleanArg, enumType } from 'nexus'
import { objectType, extendType, stringArg, arg } from 'nexus'

export const UpdateStatusPayload = objectType({
  name: 'UpdateStatusPayload',
  // node: 'id',
  definition(t) {
    // t.implements('Node')
    t.boolean('isError')
    t.string('message')
  },
})

export const UserBotSignal = objectType({
  name: 'UserBotSignal',
  definition: (t) => {
    t.model.id()
    t.model.createdAt()
    t.model.updatedAt()
    t.model.chatId()
    t.model.firstName()
    t.model.username()
    t.model.amount()
    t.model.txHash()
    t.model.status()
    t.model.isConfirm()
    t.model.isWin()
    t.model.isCheck()
    t.model.status()
    t.model.image()
    t.model.time()
  },
})

export const Status = enumType({
  name: 'Status',
  members: ['APPROVE', 'REJECT'],
})

export const UserBotSignalMutation = extendType({
  type: 'Mutation',
  definition: (t) => {
    t.field('updateStatus', {
      type: 'UpdateStatusPayload',
      args: {
        id: stringArg({ required: true }),
        status: arg({ type: 'ApprovedStatus', required: true }),
      },
      resolve: async (_, { id, status }, ctx) => {
        let user = await ctx.prisma.userBotSignal.findFirst({
          where: {
            id,
            isCheck: false,
            isWin: false,
            status: null,
            isConfirm: true,
          },
        })

        if (!user) {
          return {
            isError: true,
            message: 'Data not exists',
          }
        }

        await ctx.prisma.userBotSignal.updateMany({
          where: {
            id,
            isCheck: false,
            isWin: false,
            status: null,
            isConfirm: true,
          },
          data: {
            isCheck: true,
            status,
          },
        })

        await ctx.redis.publish(
          'check-bot-signal',
          JSON.stringify({
            chatId: user.chatId,
            status,
          }),
        )

        return {
          isError: false,
          message: '',
        }
      },
    })
  },
})

export const UserBotSignalQuery = extendType({
  type: 'Query',
  definition: (t) => {
    t.list.field('userBotSignal', {
      type: UserBotSignal,
      resolve: async (parent, _, ctx) => {
        return await ctx.prisma.userBotSignal.findMany({
          where: {
            isCheck: false,
            isWin: false,
            status: null,
            isConfirm: true,
          },
          orderBy: {
            image: 'asc',
          },
        })
      },
    })
  },
})
