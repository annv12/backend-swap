import { customAlphabet } from 'nanoid'
import * as math from './lib/math'
import { Context } from './context'
import {
  PrismaClient,
  ConvertionPair,
  Ref,
  ExchangeWallet,
  RefTransactionEventType,
  MainWallet,
  ConvertionDirection,
  UserRole,
} from '@prisma/client'
import { RefNote } from './types'
import fetch from 'node-fetch'
import { getConvertPrice } from './lib/convert-utils'
import logger from './lib/logger'
import { getF1Volume } from './lib/ref-utils'
import { ValidationError } from './lib/error-util'
import jwt from './lib/jwt'

const nanoid = customAlphabet('1234567890QWERTYUIOPASDFGHJKLZXCVBNM', 6)

type Token = {
  userId: string
  role?: UserRole
}

export function getUserId(ctx: Context) {
  const Authorization = ctx.request
    ? ctx.request.get('Authorization')
    : // @ts-ignore
      ctx.connection.context.Authorization
  if (Authorization) {
    try {
      const token = Authorization.replace('Bearer ', '')
      const verifiedToken = jwt.verify(token) as Token
      const role = verifiedToken.role || 'TRADER'

      return verifiedToken && { userId: verifiedToken.userId, role }
    } catch (err) {
      return { userId: undefined, role: undefined }
    }
  } else {
    return { userId: undefined, role: undefined }
  }
}

export async function validateConvertion(
  amount: number,
  convertionPair: ConvertionPair,
  direction: ConvertionDirection,
  i18n: any,
  prisma: PrismaClient,
) {
  const currency = await prisma.currency.findUnique({
    where: {
      id: convertionPair.currency_id,
    },
  })
  const price = await getConvertPrice(currency.symbol, direction, prisma)
  const recieve = math.mul(price, amount).toNumber()

  if (direction === 'MAIN_TO_EXCHANGE') {
    if (convertionPair.buy_max_amount < recieve) {
      return {
        error: true,
        message: i18n.__(
          'Maximum recieve amount is %@USD'.replace(
            '%@',
            `${convertionPair.buy_max_amount}`,
          ),
        ),
      }
    } else if (convertionPair.buy_min_amount > recieve) {
      return {
        error: true,
        message: i18n.__(
          'Minimum recieve amount is %@USD'.replace(
            '%@',
            `${convertionPair.buy_min_amount}`,
          ),
        ),
      }
    } else {
      return {
        error: false,
        message: 'OK',
      }
    }
  } else {
    if (convertionPair.sell_max_amount < amount) {
      return {
        error: true,
        message: i18n.__(
          'Maximum amount allowed is %@USD'.replace(
            '%@',
            `${convertionPair.sell_max_amount}`,
          ),
        ),
      }
    } else if (convertionPair.sell_min_amount > amount) {
      return {
        error: true,
        message: i18n.__(
          'Minimum amount allowed is %@USD'.replace(
            '%@',
            `${convertionPair.sell_min_amount}`,
          ),
        ),
      }
    } else {
      return {
        error: false,
        message: 'OK',
      }
    }
  }
}

export function isEnableBetRound() {
  const t = parseInt(process.env.ROOT_TIME)
  const t2 = Math.floor(Date.now() / 1000)
  const t3 = t2 - t
  const isNotEnable = Math.floor(t3 / 30) % 2

  return !isNotEnable
}

export async function getMainWalletBalanceMap(
  wallet: MainWallet,
  prisma: PrismaClient,
) {
  let balance = await getMainWalletBalance(wallet, prisma)
  let result = new Map<string, any>()
  result.set('id', wallet.id)
  result.set('balance', balance)
  return result
}

export async function getMainWalletBalance(
  wallet: MainWallet,
  prisma: PrismaClient,
) {
  const newWalletChangeAggregation = await prisma.mainWalletChange.aggregate({
    where: {
      main_wallet_id: wallet.id,
      createdAt: {
        gt: wallet.balance_cache_datetime,
      },
    },
    _sum: {
      amount: true,
    },
  })

  const balance = math
    .add(wallet.base_balance, newWalletChangeAggregation._sum.amount ?? 0)
    .toFixed(8)

  return Number(balance) < 0 ? 0 : Number(balance)
}

export async function getExchangeWalletBalance(
  wallet: ExchangeWallet,
  prisma: PrismaClient,
) {
  let amountSum = 0
  if (wallet.type === 'DEMO') {
    const newWalletChangeAggregation =
      await prisma.exchangeWalletChangeDemo.aggregate({
        where: {
          createdAt: {
            gt: wallet.balance_cache_datetime,
          },
          exchange_wallet_id: wallet.id,
        },
        _sum: {
          amount: true,
        },
      })
    amountSum = newWalletChangeAggregation._sum.amount ?? 0
  } else {
    const newWalletChangeAggregation =
      await prisma.exchangeWalletChange.aggregate({
        where: {
          createdAt: {
            gt: wallet.balance_cache_datetime,
          },
          exchange_wallet_id: wallet.id,
        },
        _sum: {
          amount: true,
        },
      })
    amountSum = newWalletChangeAggregation._sum.amount ?? 0
  }

  const balance = math.add(wallet.base_balance, amountSum).toFixed(2)

  return Number(balance) < 0 ? 0 : Number(balance)
}

export function generateRefId() {
  return nanoid()
}

export async function getRefLevel(
  user: string,
  f: number,
  commisionType: RefTransactionEventType,
  prisma: PrismaClient,
) {
  const userData = await prisma.user.findUnique({
    where: {
      id: user,
    },
    select: {
      UserProfile: true,
      username: true,
    },
  })
  if (!userData) {
    throw new Error(`User not found ${user}`)
  }
  logger.info(`[x] Check level for user: ${userData.username} at Level:${f}`)

  const refLevels = await prisma.refLevel.findMany()

  // if level = 1 => no need to check anything
  // if (f === 1) {
  //   return refLevels.find((i) => i.level === 1)
  // }

  const level = refLevels.find((i) => i.level === f)
  // if level not found
  if (!level) return

  // if AGENCY commision dont check level
  // if (commisionType === 'AGENCY') {
  //   logger.info(
  //     `[x] skip check for ${userData.username} and return level ${f} for AGENCY commission`,
  //   )
  //   return level
  // }

  const isKeepRefLevel = userData.UserProfile.is_keep_ref_level

  const refs = await prisma.ref.findMany({
    where: {
      sponsor_id: user,
    },
    select: {
      user_id: true,
    },
  })

  const refsUser = refs.map((i) => i.user_id)
  const f1AgencyP = await Promise.all(refsUser.map((i) => isAgency(i, prisma)))
  const f1Agency = f1AgencyP.filter(Boolean).length

  const f1VolumeLastWeek = await getF1Volume(
    refsUser,
    isKeepRefLevel,
    false,
    prisma,
  )
  const f1VolumeThisWeek = await getF1Volume(
    refsUser,
    isKeepRefLevel,
    true,
    prisma,
  )
  const f1Volume = Math.max(f1VolumeLastWeek, f1VolumeThisWeek)

  logger.info(
    `[x] user ${userData.username} Lv: ${level?.level || 0}/${f}, isAgency: ${
      userData.UserProfile.is_agency ? 'YES' : 'NO'
    }, F1 count: ${refsUser.length}/${
      level?.required_member
    } F1Volume: ${f1Volume}/${level?.required_commission}`,
  )

  // if TRADING commission check isAgency prop
  logger.info(`[x] user ${userData.username} isAgency ? `, {
    isAgency: userData.UserProfile.is_agency,
  })
  if (!userData.UserProfile.is_agency) return

  // if user was configured LEVEL by ADMIN
  if (userData.UserProfile.admin_config_ref_level >= f) {
    return level
  }

  // Check user ref level requirement
  if (
    level.required_agency <= f1Agency &&
    // level.required_member <= refsUser.length &&
    level.required_commission <= f1Volume
  ) {
    return level
  } else {
    return
  }
}

export async function isAgency(user: string, prisma: PrismaClient) {
  const profiles = await prisma.userProfile.findMany({
    where: {
      user_id: user,
    },
  })

  const profile = profiles[0]

  if (profile.is_agency) {
    return true
  } else {
    return false
  }
}

///////////////////////////////
/// LEGENDARY 😎 -- Jay.tr ///
/////////////////////////////
// export async function getUplineUsers(user: number, cb: (ref: Ref) => any) {
//   async function helper(user: number): Promise<any> {
//     const refs = await prisma.ref.findMany({
//       where: {
//         user_id: user,
//       },
//     })
//     const ref = refs[0]
//     if (ref) cb(ref)
//     if (!ref) return
//     return await helper(ref.sponsor_id)
//   }
//   return await helper(user)
// }

// type RefAr = Ref & { f: number }

// export async function getDownlineUsers(
//   user: number,
//   level: number = 7,
//   cb: (ref: RefAr[]) => any,
// ) {
//   let count = level + 1
//   let down = 1
//   async function getDownlineRef(users: number[]): Promise<any> {
//     const prArr = users.map(async (i) => {
//       const refs = await prisma.ref.findMany({
//         where: {
//           sponsor_id: i,
//         },
//       })
//       const dd = refs.map((i) => ({ ...i, f: down }))
//       cb(dd)
//       return refs
//     })
//     const res = await Promise.all(prArr)
//     const r = [].concat.apply([], res).map((i: any) => i.user_id)
//     count--
//     if (count === 0) return
//     down++
//     return getDownlineRef(r)
//   }

//   return await getDownlineRef([user])
// }

export async function sendCommissionToSponsorList(
  senderId: string,
  sponsorList: RefNote[],
  type: RefTransactionEventType,
  userSpentAmount: number,
  agencyTransactionId: string,
  prisma: PrismaClient,
) {
  // Create RefTransaction transaction
  const prArr = sponsorList.map(async (i) => {
    const sponsorLevel = await getRefLevel(i.user_id, i.position, type, prisma)
    logger.info(`[x] user ${i.user_id} is Lv. ${sponsorLevel?.level}`)
    if (!sponsorLevel) return

    const refs = await prisma.ref.findMany({
      where: {
        sponsor_id: i.user_id,
        user_id:
          i.position === 1
            ? senderId
            : sponsorList.find((s) => s.position === i.position - 1).user_id,
      },
    })
    const ref = refs[0]
    if (!ref) {
      logger.error(`[x] Sponsor ref is not existed`)
      return
    }

    const rate =
      type === 'AGENCY'
        ? sponsorLevel.agency_com_rate
        : sponsorLevel.trading_com_rate

    const existed_txs = await prisma.refTransaction.findMany({
      where: {
        user_id: senderId,
        sponsor_id: i.user_id,
        event_type: type,
        event_id: agencyTransactionId,
      },
    })
    const existed_tx = existed_txs[0]
    if (existed_tx) {
      logger.error('Ref transaction is existed')
      return
    }
    logger.info('[x] create transaction for: ', i)
    const ref_tx = await prisma.refTransaction.create({
      data: {
        event_type: type,
        event_id: agencyTransactionId,
        Ref: {
          connect: {
            id: ref.id,
          },
        },
        RefLevel: {
          connect: {
            id: sponsorLevel.id,
          },
        },
        User: {
          connect: {
            id: senderId,
          },
        },
        Sponsor: {
          connect: {
            id: i.user_id,
          },
        },
        amount: userSpentAmount,
        rate,
        earned: math.mul(userSpentAmount, rate).toNumber(),
      },
    })

    const liveWallets = await prisma.exchangeWallet.findMany({
      where: {
        user_id: ref_tx.sponsor_id,
        type: 'MAIN',
      },
    })
    const liveWallet = liveWallets[0]
    const res = await prisma.exchangeWalletChange.create({
      data: {
        event_type: 'REF',
        event_id: ref_tx.id,
        ExchangeWallet: {
          connect: {
            id: liveWallet.id,
          },
        },
        amount: ref_tx.earned,
      },
    })
    logger.info(`[x] Transaction created`, { ref_tx })

    return ref_tx
  })

  return await Promise.all(prArr)
}
