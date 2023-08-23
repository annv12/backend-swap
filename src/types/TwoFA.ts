import { objectType, extendType, stringArg } from 'nexus'
import * as speakeasy from 'speakeasy'
import { nanoid } from 'nanoid'
import {
  generateQrUrlTwoFA,
  BackupCode,
  checkValidAccount,
} from '../lib/auth-utils'
import { UserRole } from '@prisma/client'
import { ValidationError, AuthenticationError } from '../lib/error-util'
import { TokenTemporaryError } from '../lib/error-util'
import jwt from '../lib/jwt'

export const TwoFactor = objectType({
  name: 'TwoFactor',
  definition(t) {
    t.string('otpAuthUrl', { nullable: true })
    t.string('secret', { nullable: true })
    t.string('status')
    t.list.string('backupCodes', { nullable: true })
  },
})

export const DisableTwoFactor = objectType({
  name: 'DisableTwoFactor',
  definition(t) {
    t.boolean('success')
  },
})

type Token = {
  userId: string
  role?: UserRole
}

export const TemporaryToken = objectType({
  name: 'TemporaryToken',
  definition(t) {
    t.string('token')
  },
})

export const getTwoFARequest = extendType({
  type: 'Query',
  definition: (t) => {
    t.field('twoFactor', {
      type: 'TwoFactor',
      resolve: async (parent, args, ctx) => {
        const userId = ctx.user
        if (!userId) {
          throw new ValidationError({ message: ctx.i18n.__('Please login') })
        }
        let twoFA = await ctx.prisma.twoFactor.findUnique({
          where: { user_id: userId },
        })
        if (!twoFA) {
          // gen secret
          const secret = speakeasy.generateSecret()
          // create new twoFactor
          twoFA = await ctx.prisma.twoFactor.create({
            data: { User: { connect: { id: userId } }, secret: secret.base32 },
          })
        } else if (twoFA.status !== 'VERIFIED') {
          // generate new secrest
          const secret = speakeasy.generateSecret()
          twoFA = await ctx.prisma.twoFactor.update({
            where: { id: twoFA.id },
            data: {
              secret: secret.base32,
            },
          })
        }
        if (twoFA.status === 'VERIFIED') {
          // VERIFIED then not allow return secret
          return {
            status: twoFA.status,
          }
        }
        // Only 2fa not VERIFIED then allow return secret
        // console.log('secret: ', secret)
        // "otpauth://totp/{}:{}?secret={}&digits=6&issuer={}"
        // get user email
        let user = await ctx.prisma.user.findUnique({ where: { id: userId } })
        if (!user) {
          throw new ValidationError({ message: ctx.i18n.__('Please login') })
        }

        return {
          otpAuthUrl: generateQrUrlTwoFA(twoFA.secret, user.email),
          secret: twoFA.secret,
          status: twoFA.status,
        }
      },
    })
  },
})
export const createTwoFARequest = extendType({
  type: 'Mutation',
  definition: (t) => {
    t.field('disableTwoFactor', {
      type: 'DisableTwoFactor',
      args: {
        token: stringArg({ required: true }),
        password: stringArg({ required: true }),
        captchaToken: stringArg(),
      },
      resolve: async (_, { token, password, captchaToken }, ctx) => {
        const userId = ctx.user
        if (!userId) {
          throw new ValidationError({ message: ctx.i18n.__('Please login') })
        }
        // get user info to get email later
        let user = await ctx.prisma.user.findUnique({ where: { id: userId } })
        if (!user) {
          throw new ValidationError({ message: ctx.i18n.__('Not found user') })
        }

        await checkValidAccount(user, password, ctx)

        const items = await ctx.prisma.twoFactor.findMany({
          where: {
            user_id: userId,
          },
        })
        if (!items || items.length === 0) {
          throw new ValidationError({
            message: ctx.i18n.__('Two factor not created'),
          })
        }
        const twoFA = items[0]
        if (twoFA.status === 'DISABLED') {
          throw new ValidationError({
            message: ctx.i18n.__('Two factor was disabled'),
          })
        }
        if (twoFA.status === 'PENDING') {
          throw new ValidationError({
            message: ctx.i18n.__('Two factor was pending'),
          })
        }
        const isValidToken = speakeasy.totp.verify({
          secret: twoFA.secret,
          encoding: 'base32',
          token: token,
        })
        let isValidBakCodes = false
        if (!isValidToken) {
          // check bakup code
          let bakCodes = twoFA.backup_codes as any
          let bakCode: BackupCode = bakCodes[token]
          // exist bak code and not used
          if (bakCode && !bakCode.usedAt) {
            isValidBakCodes = true
            let date = new Date()
            bakCode.usedAt = date.toUTCString()
            bakCodes[token] = bakCode
            twoFA.backup_codes = bakCodes
          }
        }
        if (isValidToken || isValidBakCodes) {
          await ctx.prisma.twoFactor.update({
            where: { id: twoFA.id },
            data: {
              status: 'DISABLED',
              backup_codes: undefined,
            },
          })
        } else {
          throw new ValidationError({ message: ctx.i18n.__('Token not valid') })
        }
        return { success: isValidToken || isValidBakCodes }
      },
    })

    t.field('enableTwoFactor', {
      type: 'TwoFactor',
      args: {
        token: stringArg({ required: true }),
        password: stringArg({ required: true }),
        captchaToken: stringArg(),
      },
      resolve: async (_, { token, password, captchaToken }, ctx) => {
        const userId = ctx.user
        if (!userId) {
          throw new ValidationError({ message: ctx.i18n.__('Please login') })
        }
        // get user info to get email later
        let user = await ctx.prisma.user.findUnique({ where: { id: userId } })
        if (!user) {
          throw new ValidationError({ message: ctx.i18n.__('Not found user') })
        }
        await checkValidAccount(user, password, ctx)

        const items = await ctx.prisma.twoFactor.findMany({
          where: {
            user_id: userId,
          },
        })
        if (!items || items.length === 0) {
          throw new ValidationError({
            message: ctx.i18n.__('Two factor not created'),
          })
        }
        let twoFA = items[0]
        if (twoFA.status === 'VERIFIED') {
          throw new ValidationError({
            message: ctx.i18n.__('Two factor was verified'),
          })
        }

        let isValidToken = speakeasy.totp.verify({
          secret: twoFA.secret,
          encoding: 'base32',
          token: token,
        })
        let isValidBakCodes = false
        let bakCodes = twoFA.backup_codes as any
        if (!isValidToken) {
          // check bakup code
          // if bak codes is existed and not array (need type is dictionary)
          if (bakCodes && !Array.isArray(bakCodes)) {
            let bakCode: BackupCode = bakCodes[token]
            // exist bak code and not used
            if (bakCode && !bakCode.usedAt) {
              isValidBakCodes = true
              let date = new Date()
              bakCode.usedAt = date.toUTCString()
              bakCodes[token] = bakCode
              twoFA.backup_codes = bakCodes
            }
          }
        }
        let backupCodes: string[]
        if (isValidToken || isValidBakCodes) {
          // if bak codes is null or is array (default data, need type is dictionary)
          if (!bakCodes || Array.isArray(bakCodes)) {
            // gen backup code
            let backupObjs: any = {}
            backupCodes = []
            for (let index = 0; index < 10; index++) {
              let code = nanoid(6)
              let bakCode: BackupCode = {
                usedAt: null,
              }
              backupObjs[code] = bakCode
              backupCodes.push(code)
            }
            twoFA.backup_codes = backupObjs
          }

          twoFA = await ctx.prisma.twoFactor.update({
            where: { id: twoFA.id },
            data: { status: 'VERIFIED', backup_codes: twoFA.backup_codes },
          })
        } else {
          throw new ValidationError({ message: ctx.i18n.__('Token not valid') })
        }

        return {
          otpAuthUrl: generateQrUrlTwoFA(twoFA.secret, user.email),
          secret: twoFA.secret,
          status: twoFA.status,
          backupCodes: backupCodes,
        }
      },
    })

    t.field('generateTemporaryToken', {
      type: 'TemporaryToken',
      args: {
        password: stringArg({ required: true }),
        captchaToken: stringArg(),
      },
      resolve: async (_, { password, captchaToken }, ctx) => {
        const userId = ctx.user
        // get user info to get email later
        let user = await ctx.prisma.user.findUnique({ where: { id: userId } })
        if (!user) {
          throw new ValidationError({ message: ctx.i18n.__('Not found user') })
        }
        await checkValidAccount(user, password, ctx)

        return {
          token: jwt.sign({ userId: user.id, role: user.role }, '15m'),
        }
      },
    })

    t.field('enableTwoFactorMobile', {
      type: 'TwoFactor',
      args: {
        token: stringArg({ required: true }),
        temporaryToken: stringArg({ required: true }),
      },
      resolve: async (_, { token, temporaryToken }, ctx) => {
        const userId = ctx.user
        // get user info to get email later
        let user = await ctx.prisma.user.findUnique({ where: { id: userId } })
        if (!user) {
          throw new ValidationError({ message: ctx.i18n.__('Not found user') })
        }
        let verifiedToken
        try {
          verifiedToken = jwt.verify(temporaryToken) as Token
        } catch (error) {
          console.log(error)
          throw new TokenTemporaryError({
            message: ctx.i18n.__(
              'Temporary token expired, please enter password again!',
            ),
          })
        }

        if (userId != verifiedToken.userId) {
          throw new ValidationError({
            message: ctx.i18n.__('Not valid temporary token'),
          })
        }

        const items = await ctx.prisma.twoFactor.findMany({
          where: {
            user_id: userId,
          },
        })
        if (!items || items.length === 0) {
          throw new ValidationError({
            message: ctx.i18n.__('Two factor not created'),
          })
        }
        let twoFA = items[0]
        if (twoFA.status === 'VERIFIED') {
          throw new ValidationError({
            message: ctx.i18n.__('Two factor was verified'),
          })
        }

        let isValidToken = speakeasy.totp.verify({
          secret: twoFA.secret,
          encoding: 'base32',
          token: token,
        })
        let isValidBakCodes = false
        let bakCodes = twoFA.backup_codes as any
        if (!isValidToken) {
          // check bakup code
          // if bak codes is existed and not array (need type is dictionary)
          if (bakCodes && !Array.isArray(bakCodes)) {
            let bakCode: BackupCode = bakCodes[token]
            // exist bak code and not used
            if (bakCode && !bakCode.usedAt) {
              isValidBakCodes = true
              let date = new Date()
              bakCode.usedAt = date.toUTCString()
              bakCodes[token] = bakCode
              twoFA.backup_codes = bakCodes
            }
          }
        }
        let backupCodes: string[]
        if (isValidToken || isValidBakCodes) {
          // if bak codes is null or is array (default data, need type is dictionary)
          if (!bakCodes || Array.isArray(bakCodes)) {
            // gen backup code
            let backupObjs: any = {}
            backupCodes = []
            for (let index = 0; index < 10; index++) {
              let code = nanoid(6)
              let bakCode: BackupCode = {
                usedAt: null,
              }
              backupObjs[code] = bakCode
              backupCodes.push(code)
            }
            twoFA.backup_codes = backupObjs
          }

          twoFA = await ctx.prisma.twoFactor.update({
            where: { id: twoFA.id },
            data: { status: 'VERIFIED', backup_codes: twoFA.backup_codes },
          })
        } else {
          throw new ValidationError({ message: ctx.i18n.__('Token not valid') })
        }

        return {
          otpAuthUrl: generateQrUrlTwoFA(twoFA.secret, user.email),
          secret: twoFA.secret,
          status: twoFA.status,
          backupCodes: backupCodes,
        }
      },
    })

    t.field('disableTwoFactorMobile', {
      type: 'DisableTwoFactor',
      args: {
        token: stringArg({ required: true }),
        temporaryToken: stringArg({ required: true }),
      },
      resolve: async (_, { token, temporaryToken }, ctx) => {
        const userId = ctx.user
        // get user info to get email later
        let user = await ctx.prisma.user.findUnique({ where: { id: userId } })
        if (!user) {
          throw new ValidationError({ message: ctx.i18n.__('Not found user') })
        }

        let verifiedToken
        try {
          verifiedToken = jwt.verify(temporaryToken) as Token
        } catch (error) {
          console.log(error)
          throw new TokenTemporaryError({
            message: ctx.i18n.__(
              'Temporary token expired, please enter password again!',
            ),
          })
        }

        if (userId != verifiedToken.userId) {
          throw new ValidationError({
            message: ctx.i18n.__('Not valid temporary token'),
          })
        }

        const items = await ctx.prisma.twoFactor.findMany({
          where: {
            user_id: userId,
          },
        })
        if (!items || items.length === 0) {
          throw new ValidationError({
            message: ctx.i18n.__('Two factor not created'),
          })
        }
        const twoFA = items[0]
        if (twoFA.status === 'DISABLED') {
          throw new ValidationError({
            message: ctx.i18n.__('Two factor was disabled'),
          })
        }
        if (twoFA.status === 'PENDING') {
          throw new ValidationError({
            message: ctx.i18n.__('Two factor was pending'),
          })
        }
        const isValidToken = speakeasy.totp.verify({
          secret: twoFA.secret,
          encoding: 'base32',
          token: token,
        })
        let isValidBakCodes = false
        if (!isValidToken) {
          // check bakup code
          let bakCodes = twoFA.backup_codes as any
          let bakCode: BackupCode = bakCodes[token]
          // exist bak code and not used
          if (bakCode && !bakCode.usedAt) {
            isValidBakCodes = true
            let date = new Date()
            bakCode.usedAt = date.toUTCString()
            bakCodes[token] = bakCode
            twoFA.backup_codes = bakCodes
          }
        }
        if (isValidToken || isValidBakCodes) {
          await ctx.prisma.twoFactor.update({
            where: { id: twoFA.id },
            data: {
              status: 'DISABLED',
              backup_codes: null,
            },
          })
        } else {
          throw new ValidationError({ message: ctx.i18n.__('Token not valid') })
        }
        return { success: isValidToken || isValidBakCodes }
      },
    })
  },
})
