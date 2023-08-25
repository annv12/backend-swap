import { objectType, extendType, stringArg, booleanArg } from 'nexus'
import { generateRefId } from '../utils'
import { compare, hash } from 'bcryptjs'
import logger from '../lib/logger'
import jwt from '../lib/jwt'
import { checkTokenTwoFaEnabled } from '../lib/auth-utils'
import {
  sendLoginMail,
  sendForgotMail,
  sendVerifyMail,
} from '../lib/mail-utils'
import { generateREFNote } from '../lib/ref-utils'
import { AuthenticationError, ValidationError } from '../lib/error-util'
import { pushNotication } from '../lib/notify-utils'
import { validatePassword } from '../lib/utils'
import { UserRole } from '@prisma/client'

export const coinheIDAuthMessagePayload = objectType({
  name: 'CoinheIDAuthMessagePayload',
  definition: (t) => {
    t.string('message')
    t.string('redirectUrl', { nullable: true })
  },
})

export const coinheIDAuthPayload = objectType({
  name: 'CoinheAuthPayload',
  definition: (t) => {
    t.string('token', { nullable: true })
    t.string('ctoken', { nullable: true })
    t.field('user', { type: 'User' })
    t.boolean('hasTwoFactor', { nullable: true })
  },
})

const REGEX_USER_NAME = new RegExp('^[a-z0-9_]{2,32}$')

export const coinheIDMutation = extendType({
  type: 'Mutation',
  definition: (t) => {
    t.field('register', {
      type: 'AuthPayload',
      nullable: true,
      args: {
        username: stringArg({ required: true }),
        email: stringArg({ required: true }),
        password: stringArg({ required: true }),
        password_confirmation: stringArg({ required: true }),
        refCode: stringArg({ required: false }),
      },
      resolve: async (
        _,
        { username, email, password, password_confirmation, refCode },
        ctx,
      ) => {
        username = username.toLowerCase()
        // validate
        if (!REGEX_USER_NAME.test(username)) {
          throw new ValidationError({
            message: ctx.i18n.__(
              'Username not valid. Only characters a-z, 0-9 and _ are acceptable',
            ),
          })
        }

        if (!validatePassword(password)) {
          throw new ValidationError({
            message: ctx.i18n.__(
              'Password not valid. The string must contain at least 1 lowercase, 1 uppercase, 1 numeric, 1 special character and must be eight characters or longer',
            ),
          })
        }
        if (password !== password_confirmation) {
          throw new ValidationError({
            message: ctx.i18n.__('Confirm password does not match'),
          })
        }
        let sponsor = undefined
        if (refCode) {
          sponsor = await ctx.prisma.userProfile.findUnique({
            where: {
              ref_code: refCode,
            },
          })
          logger.info('[CoinheID.register] Sponsor profile: ', sponsor)

          if (!sponsor)
            throw new ValidationError({
              message: ctx.i18n.__('Cannot find refcode'),
            })
        }
        // check exist account
        const existUser = await ctx.prisma.user.findFirst({
          where: {
            OR: [
              {
                email,
              },
              {
                username,
              },
            ],
          },
        })
        if (existUser) {
          throw new ValidationError({
            message: ctx.i18n.__('Account already exists'),
          })
        }

        const hashedPassword = await hash(password, 10)
        let ip = ctx.request.headers['x-forwarded-for'] || ''
        ip = ip.split(',')[0]
        const user = await ctx.prisma.user.create({
          data: {
            username: username.trim().toLowerCase(),
            email: email.trim().toLowerCase(),
            password: hashedPassword,
            is_active: true,
            ExchangeWallet: {
              create: [
                {
                  type: 'MAIN',
                  base_balance: 0,
                  balance_cache_datetime: new Date(),
                },
              ],
            },
            UserProfile: {
              create: {
                status: 'NORMAL',
                ref_code: generateRefId(),
              },
            },
            ip,
          },
        })
        logger.info('[register] Created user', user)

        if (refCode) {
          logger.info('[register] Register with Ref', { refCode })
          if (!sponsor) {
            throw new ValidationError({
              message: ctx.i18n.__('Cannot find refcode'),
            })
          }

          // 🤯
          const refNote = await generateREFNote(sponsor.user_id, ctx.prisma)
          logger.info('[register] Sponsor list: ', { refNote })

          const refData = await ctx.prisma.ref.create({
            data: {
              User: {
                connect: {
                  id: user.id,
                },
              },
              Sponsor: {
                connect: {
                  id: sponsor.user_id,
                },
              },
              note: refNote,
            },
          })
          logger.info(`[register] Ref data: `, refData)
        }

        logger.info(`[register] Done registered user: ${user.id}`)
        // send email active
        // sendVerifyMail(
        //   user.email,
        //   user.username,
        //   `${process.env.OFFICIAL_PAGE}/active?token=${token}`,
        // )

        return {
          token: '',
          user,
        }
      },
    })

    t.field('resendActivationEmail', {
      type: 'Boolean',
      args: {
        email: stringArg({ nullable: false }),
      },
      resolve: async (_parent, { email }, ctx) => {
        const user = await ctx.prisma.user.findUnique({
          where: {
            email,
          },
        })
        if (!user) {
          throw new ValidationError({ message: ctx.i18n.__('bad_request') })
        }
        if (user.is_active == true) {
          throw new ValidationError({ message: ctx.i18n.__('bad_request') })
        }
        // send email active
        const token = jwt.sign(
          {
            userId: user.id,
          },
          '1d',
        )
        sendVerifyMail(
          user.email,
          user.username,
          `${process.env.OFFICIAL_PAGE}/active?token=${token}`,
        )
        return true
      },
    })

    t.field('login2', {
      type: 'CoinheAuthPayload',
      nullable: true,
      args: {
        username: stringArg({ required: true }),
        password: stringArg({ required: true }),
        capchaToken: stringArg({ required: true }),
        isMobile: booleanArg({ required: false }),
      },
      resolve: async (
        _,
        { username, password, capchaToken, isMobile },
        ctx,
      ) => {
        username = username.toLowerCase()
        const user = await ctx.prisma.user.findFirst({
          where: {
            OR: [
              {
                username,
              },
              {
                email: username,
              },
            ],
          },
          include: {
            UserProfile: true,
          },
        })
        if (!user) {
          throw new AuthenticationError({
            message: ctx.i18n.__(`Incorrect account or password`),
          })
        }
        logger.info(`[login] Find userID: ${user.id}`)
        // compare password
        const passwordValid = await compare(password, user.password)
        if (!passwordValid) {
          throw new AuthenticationError({
            message: ctx.i18n.__('Incorrect account or password'),
          })
        }

        if (!user.is_active) {
          throw new AuthenticationError({
            message: ctx.i18n.__(`Please active account`),
            data: {
              code: 403,
              email: user.email,
            },
          })
        }

        if (['BANNED', 'SUSPENDED'].indexOf(user?.UserProfile?.status) >= 0) {
          throw new AuthenticationError({
            message: ctx.i18n.__(
              `Your account is ${user?.UserProfile?.status}`,
            ),
          })
        }

        // check enable two fa
        const twoFA = await ctx.prisma.twoFactor.findUnique({
          where: {
            user_id: user.id,
          },
        })
        if (twoFA && twoFA.status === 'VERIFIED') {
          // must verify 2fa to login
          return {
            hasTwoFactor: true,
            user,
            token: null,
          }
        }

        if (user.role !== UserRole.ADMIN) {
          sendLoginMail(user.email, user.username, ctx.request)
        }

        ctx.user = user.id
        return {
          token: jwt.sign({ userId: user.id, role: user.role }),
          user,
        }
      },
    })

    t.field('loginWithTwoFa', {
      type: 'CoinheAuthPayload',
      args: {
        userId: stringArg({ nullable: false }),
        otp: stringArg({ nullable: false }),
      },
      resolve: async (_parent, { userId, otp }, ctx) => {
        const user = await ctx.prisma.user.findUnique({
          where: {
            id: userId,
          },
        })
        if (!user) {
          throw new ValidationError({ message: ctx.i18n.__('bad_request') })
        }
        await checkTokenTwoFaEnabled(otp, userId, ctx.prisma, ctx.i18n)
        sendLoginMail(user.email, user.username, ctx.request)
        ctx.user = userId
        pushNotication('LOGIN', ctx)
        return {
          token: jwt.sign({ userId: user.id, role: user.role }),
          user,
        }
      },
    })

    t.field('logout', {
      type: 'Boolean',
      args: {
        deviceToken: stringArg({ required: true }),
      },
      resolve: async (_parent, { deviceToken }, ctx) => {
        const devices = await ctx.prisma.device.findMany({
          where: {
            user_id: ctx.user,
            token: deviceToken,
          },
        })
        if (!devices || devices.length === 0) {
          throw new ValidationError({
            message: ctx.i18n.__('Device not found'),
          })
        }
        await ctx.prisma.device.update({
          where: {
            id: devices[0].id,
          },
          data: {
            enable: false,
          },
        })

        return true
      },
    })

    t.field('changePassword', {
      type: 'CoinheIDAuthMessagePayload',
      args: {
        old_password: stringArg({ required: true }),
        password: stringArg({ required: true }),
        password_confirmation: stringArg({ required: true }),
      },
      resolve: async (
        _,
        { old_password, password, password_confirmation },
        ctx,
      ) => {
        let user = await ctx.prisma.user.findUnique({
          where: {
            id: ctx.user,
          },
        })
        if (!user) {
          throw new ValidationError({
            message: `Account not exist`,
          })
        }
        // compare password
        const passwordValid = await compare(old_password, user.password)
        if (!passwordValid) {
          throw new ValidationError({
            message: `Old password invalid`,
          })
        }

        if (!validatePassword(password)) {
          throw new ValidationError({
            message: ctx.i18n.__(
              'Password not valid. The string must contain at least 1 lowercase, 1 uppercase, 1 numeric, 1 special character and must be eight characters or longer',
            ),
          })
        }
        if (password !== password_confirmation) {
          throw new ValidationError({
            message: ctx.i18n.__('Confirm password does not match'),
          })
        }

        // update pass
        const hashedPassword = await hash(password, 10)
        await ctx.prisma.user.update({
          where: {
            id: ctx.user,
          },
          data: {
            password: hashedPassword,
          },
        })

        return {
          message: ctx.i18n.__('Change password successfully'),
        }
      },
    })

    t.field('forgotPassword', {
      type: 'CoinheIDAuthMessagePayload',
      args: {
        email: stringArg({ required: true }),
      },
      resolve: async (_, { email }, ctx) => {
        const user = await ctx.prisma.user.findUnique({
          where: {
            email,
          },
        })
        if (!user) {
          throw new ValidationError({
            message: `Account not exist`,
          })
        }
        if (!user.is_active) {
          throw new ValidationError({
            message: ctx.i18n.__('Please active account'),
          })
        }
        // send mail
        const token = jwt.sign(
          {
            userId: user.id,
          },
          '1d',
        )
        sendForgotMail(
          user.email,
          user.username,
          `${process.env.OFFICIAL_PAGE}/reset?token=${token}&email=${user.email}`,
        )
        return {
          message: 'Request successfuly',
        }
      },
    })

    t.field('resetPassword', {
      type: 'CoinheIDAuthMessagePayload',
      args: {
        email: stringArg({ required: true }),
        password: stringArg({ required: true }),
        password_confirmation: stringArg({ required: true }),
        token: stringArg({ required: true }),
      },
      resolve: async (
        _,
        { email, password, password_confirmation, token },
        ctx,
      ) => {
        if (!validatePassword(password)) {
          throw new ValidationError({
            message: ctx.i18n.__(
              'Password not valid. The string must contain at least 1 lowercase, 1 uppercase, 1 numeric, 1 special character and must be eight characters or longer',
            ),
          })
        }
        if (password !== password_confirmation) {
          throw new ValidationError({
            message: ctx.i18n.__('Confirm password does not match'),
          })
        }

        const info = jwt.verify(token) as { userId: string }
        if (info != null) {
          const user = await ctx.prisma.user.findUnique({
            where: {
              id: info.userId,
            },
          })
          if (!user) {
            throw new AuthenticationError({
              message: ctx.i18n.__('Account not exists'),
            })
          }
          if (user.email !== email) {
            throw new AuthenticationError({
              message: ctx.i18n.__('Data invalid'),
            })
          }
          if (!user.is_active) {
            throw new AuthenticationError({
              message: ctx.i18n.__('Please active account'),
            })
          }
          const hashedPassword = await hash(password, 10)
          await ctx.prisma.user.update({
            where: {
              id: info.userId,
            },
            data: {
              password: hashedPassword,
            },
          })
          return { message: ctx.i18n.__('Account reset succeed') }
        } else {
          throw new ValidationError({
            message: ctx.i18n.__('Account reset failed'),
          })
        }
      },
    })

    t.field('verifyAccount', {
      type: 'CoinheIDAuthMessagePayload',
      args: {
        token: stringArg({ required: true }),
      },
      resolve: async (_, { token }, ctx) => {
        const info = jwt.verify(token) as { userId: string }
        if (info) {
          const user = await ctx.prisma.user.findUnique({
            where: {
              id: info.userId,
            },
          })
          if (!user) {
            throw new ValidationError({
              message: ctx.i18n.__('Account not exists'),
            })
          }
          if (user.is_active === true) {
            throw new ValidationError({
              message: ctx.i18n.__('Account has been activated'),
            })
          }
          await ctx.prisma.user.update({
            where: {
              id: info.userId,
            },
            data: {
              is_active: true,
            },
          })
          return { message: ctx.i18n.__('Account verification succeed') }
        } else {
          throw new ValidationError({
            message: ctx.i18n.__('ccount verification failed'),
          })
        }
      },
    })
  },
})
