import * as speakeasy from 'speakeasy'
import { PrismaClient, Permission, User } from '@prisma/client'
import { ValidationError } from './error-util'
import { Context } from '../context'
import { compare } from 'bcryptjs'
import logger from './logger'

export interface BackupCode {
  usedAt: String
}

export function generateQrUrlTwoFA(secret: string, email: string): string {
  const appName = 'Voption' // process.env.AppName
  return `otpauth://totp/${appName}:${email}?secret=${secret}&issuer=${appName}`
}

export const checkTokenTwoFaEnabled = async (
  otpToken: string,
  userId: string,
  prisma: PrismaClient,
  i18n: any,
) => {
  if (!userId) {
    throw new ValidationError({ message: 'Missing param userId' })
  }
  const userProfile = await prisma.userProfile.findUnique({
    where: {
      user_id: userId,
    },
  })

  // Check if admin config bypass 2fa for user
  if (!userProfile) {
    throw new ValidationError({ message: 'User not found' })
  }
  if (userProfile.admin_config_bypass_2fa === true) {
    logger.info(`BYPASS 2FA for ${userId}`)
    return true
  }

  // check 2fa
  const twoFA = await prisma.twoFactor.findUnique({
    where: {
      user_id: userId,
    },
  })
  if (!twoFA || twoFA.status !== 'VERIFIED') {
    throw new ValidationError({
      message: i18n.__('Two factor not enable'),
    })
  }
  const isValidToken = speakeasy.totp.verify({
    secret: twoFA.secret,
    encoding: 'base32',
    token: otpToken,
  })
  let isValidBakCodes = false
  if (!isValidToken) {
    // check bakup code
    let bakCodes = twoFA.backup_codes as any
    let bakCode: BackupCode = bakCodes[otpToken]
    // exist bak code and not used
    if (bakCode && !bakCode.usedAt) {
      isValidBakCodes = true
      let date = new Date()
      bakCode.usedAt = date.toUTCString()
      bakCodes[otpToken] = bakCode
      twoFA.backup_codes = bakCodes
      // save back code used
      await prisma.twoFactor.update({
        where: { id: twoFA.id },
        data: { backup_codes: bakCodes },
      })
    }
  }
  if (!isValidToken && !isValidBakCodes) {
    throw new ValidationError({ message: i18n.__('OTP not valid') })
  }
}

export async function checkValidAccount(
  user: User,
  password: string,
  ctx: Context,
) {
  const validPass = await compare(password, user.password)
  if (!validPass) {
    throw new ValidationError({ message: ctx.i18n.__('Invalid password') })
  }
}

export async function checkPermissions(
  ctx: Context,
  // userId: number,
  permissions: [Permission],
) {
  let user = await ctx.prisma.user.findUnique({ where: { id: ctx.user } })
  if (user.role === 'ADMIN') {
    return
  }
  if (
    !permissions.every((pms) => {
      return user.permissions.includes(pms)
    })
  ) {
    throw new ValidationError({ message: ctx.i18n.__('Not have permissions') })
  }
}
