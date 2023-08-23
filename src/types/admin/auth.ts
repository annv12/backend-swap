import { objectType, extendType, stringArg } from 'nexus'
import { compare, hash } from 'bcryptjs'
import jwt from '../../lib/jwt'
import { ValidationError, AuthenticationError } from '../../lib/error-util'

// export const UserRole = enumType({
//   name: 'UserRole',
//   members: ["TRADER", "STAFF", "ADMIN"]
// })

export const adminAuthPayload = objectType({
  name: 'AdminAuthPayload',
  definition: (t) => {
    t.string('token', { nullable: true })
    t.field('user', { type: 'User' })
  },
})

export const adminAuthen = extendType({
  type: 'Mutation',
  definition: (t) => {
    // t.field('registerAdmin', {
    //   type: 'AdminAuthPayload',
    //   args: {
    //     username: stringArg({ required: true }),
    //     email: stringArg({ required: true }),
    //     password: stringArg({ required: true }),
    //     appKey: stringArg({ required: true }),
    //   },
    //   resolve: async (_, { username, email, password, appKey }, ctx) => {
    //     if (appKey !== SECURE) {
    //       throw new ValidationError({ message: 'Bad Request' })
    //     }
    //     // check user existed
    //     const userExisteds = await ctx.prisma.user.findMany({
    //       where: {
    //         OR: [
    //           {
    //             username: username.toLowerCase(),
    //           },
    //           {
    //             email: email.toLowerCase(),
    //           },
    //         ],
    //       },
    //     })
    //     if (userExisteds && userExisteds.length > 0) {
    //       throw new ValidationError({ message: 'User existed' })
    //     }
    //     // create new
    //     const hashedPassword = await hash(password, 10)

    //     const user = await ctx.prisma.user.create({
    //       data: {
    //         username: username.toLowerCase(),
    //         email: email.toLowerCase(),
    //         password: hashedPassword,
    //         role: 'ADMIN',
    //         UserProfile: {
    //           create: {
    //             status: 'NORMAL',
    //             ref_code: generateRefId(),
    //           },
    //         },
    //       },
    //     })
    //     return {
    //       user,
    //     }
    //   },
    // })
    t.field('loginAdmin', {
      type: 'AdminAuthPayload',
      nullable: true,
      args: {
        username: stringArg({ required: true }),
        password: stringArg({ required: true }),
        captchaToken: stringArg({ required: false }),
      },
      resolve: async (_, { username, password, captchaToken }, ctx) => {
        let user = await ctx.prisma.user.findUnique({
          where: {
            username: username.toLowerCase(),
          },
        })
        if (!user) {
          throw new ValidationError({ message: 'Bad request' })
        }
        if (!user.role || user.role === 'TRADER') {
          throw new ValidationError({ message: 'Bad request' })
        }
        const passwordValid = await compare(password, user.password)
        if (!passwordValid) {
          throw new AuthenticationError({
            message: ctx.i18n.__('Incorrect account or password'),
          })
        }

        return {
          token: jwt.sign({ userId: user.id, role: user.role }),
          user,
        }
      },
    })
  },
})
