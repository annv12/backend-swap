import { objectType, extendType, stringArg } from 'nexus'
import jwt from '../../lib/jwt'

export const TokenLogin = objectType({
  name: 'TokenLogin',
  definition: (t) => {
    t.string('token')
  },
})

export const TokenLoginMutation = extendType({
  type: 'Mutation',
  definition: (t) => {
    t.field('generateToken', {
      type: 'TokenLogin',
      args: {
        userName: stringArg({ required: true }),
      },
      resolve: async (_, args, ctx) => {
        const user = await ctx.prisma.user.findUnique({
          where: {
            username: args.userName,
          },
        })

        const token = jwt.sign({ userId: user.id, role: user.role })
        return { token }
      },
    })
  },
})
