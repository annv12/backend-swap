import { objectType, extendType, intArg, arg, stringArg } from 'nexus'
import {
  getExchangeWalletBalance,
  sendCommissionToSponsorList,
  isAgency,
} from '../utils'
import * as math from '../lib/math'
import logger from '../lib/logger'
import {
  getF1Volume,
  getRefNetworkTreeData,
  getREFNetwork,
} from '../lib/ref-utils'
import { sendAgencyLicenseMail } from '../lib/mail-utils'
import { ValidationError } from '../lib/error-util'
import { pushNotication } from '../lib/notify-utils'
import { Prisma } from '@prisma/client'
import { Context } from '../context'

export type RefNote = {
  position: number
  ref_id: string
  user_id: string
  sponsor_id: string
}

export const Ref = objectType({
  name: 'Ref',
  definition: (t) => {
    t.model.id()
    t.model.createdAt()
    t.model.updatedAt()
    t.model.sponsor_id()
    t.model.note()
    t.model.user_id()
    t.model.User()
  },
})

export const RefLevel = objectType({
  name: 'RefLevel',
  definition: (t) => {
    t.model.id()
    t.model.createdAt()
    t.model.updatedAt()
    t.model.is_enable()
    t.model.level()
    t.model.personalVolume()
    t.model.name()
    t.model.required_agency()
    t.model.required_commission()
    t.model.required_member()
    t.model.trading_com_rate()
    t.model.agency_com_rate()
  },
})

export const RefTransaction = objectType({
  name: 'RefTransaction',
  definition: (t) => {
    t.model.id()
    t.model.createdAt()
    t.model.updatedAt()
    t.model.rate()
    t.model.amount()
    t.model.earned()
    t.model.event_id()
    t.model.event_type()
    t.model.ref_id()
    t.model.Ref()
    t.model.ref_level_id()
    t.model.RefLevel()
    t.string('username')
  },
})

export const RefTransactionCustom = objectType({
  name: 'RefTransactionCustom',
  definition: (t) => {
    t.string('level')
    t.float('percentVolume')
    t.int('agencyF1')
    t.float('branchVolume')
    t.float('commission')
  },
})

export const AgencyLicenceTransaction = objectType({
  name: 'AgencyLicenceTransaction',
  definition: (t) => {
    t.model.id()
    t.model.createdAt()
    t.model.amount()
    t.model.user_id()
  },
})

export const refChartPayload = objectType({
  name: 'RefChartPayload',
  definition: (t) => {
    t.field('refs', { type: 'Ref', list: true })
    t.field('agencies', { type: 'UserProfile', list: true })
    t.field('commissions', { type: 'RefTransaction', list: true })
  },
})

export const RefTransactionAggregate = objectType({
  name: 'RefTransactionAggregate',
  definition: (t) => {
    t.int('count')
  },
})

export const RefMutation = extendType({
  type: 'Mutation',
  definition: (t) => {
    t.field('buyAgencyLicence', {
      type: 'AgencyLicenceTransaction',
      resolve: async (_, args, ctx) => {
        const user = await ctx.prisma.user.findUnique({
          where: {
            id: ctx.user,
          },
          include: {
            UserProfile: true,
          },
        })

        if (user.UserProfile.is_agency) {
          throw new ValidationError({
            message: ctx.i18n.__(`You already buy agency license`),
          })
        }
        const lock = await ctx.redlock.lock(`lock:buyAgency:${ctx.user}`, 3000)

        try {
          const refConfig = await ctx.prisma.refConfig.findFirst()

          const userExchangeWallets = await ctx.prisma.exchangeWallet.findMany({
            where: {
              user_id: ctx.user,
            },
          })
          const userExchangeLiveWallet = userExchangeWallets.find(
            (i) => i.type === 'MAIN',
          )
          const userLiveWalletBalace = await getExchangeWalletBalance(
            userExchangeLiveWallet,
            ctx.prisma,
          )

          if (userLiveWalletBalace < refConfig.licence_price) {
            throw new ValidationError({
              message: ctx.i18n.__('not_enough_balance'),
            })
          }

          const agencyTransaction =
            await ctx.prisma.agencyLicenceTransaction.create({
              data: {
                User: {
                  connect: {
                    id: ctx.user,
                  },
                },
                amount: refConfig.licence_price,
              },
            })

          await ctx.prisma.exchangeWalletChange.create({
            data: {
              ExchangeWallet: {
                connect: {
                  id: userExchangeLiveWallet.id,
                },
              },
              amount: -refConfig.licence_price,
              event_type: 'AGENCY_LICENCE',
              event_id: agencyTransaction.id,
            },
          })

          // Update UserProfile.is_agency
          const profiles = await ctx.prisma.userProfile.findMany({
            where: {
              user_id: ctx.user,
            },
            include: {
              User: true,
            },
          })
          const profile = profiles[0]
          await ctx.prisma.userProfile.update({
            where: {
              id: profile.id,
            },
            data: {
              is_agency: true,
            },
          })

          const refs = await ctx.prisma.ref.findMany({
            where: {
              user_id: ctx.user,
            },
            include: {
              Sponsor: true
            }
          })

          const ref = refs[0]
          if (ref) {
            const sponsorList = ref.note as RefNote[]
            logger.info('[Ref.buyAgencyLisence] sponsorList: ', sponsorList)

            const comTxs = await sendCommissionToSponsorList(
              ctx.user,
              sponsorList,
              'AGENCY',
              refConfig.licence_price,
              agencyTransaction.id,
              ctx.prisma,
            )

            Promise.all(
              comTxs.map(async (comTx) => {
                const spender = await ctx.prisma.user.findFirst({
                  where: {
                    id: comTx.user_id,
                  },
                })
                await pushNotication(
                  'AGENCY_COMMISSION',
                  {
                    prisma: ctx.prisma,
                    user: comTx.sponsor_id,
                    pubsub: ctx.pubsub,
                  } as Context,
                  `Agency Commission`,
                  `Congratulations! You've earned $${comTx.earned} from @${
                    spender.username || spender.email
                  }. Please check your commission on Referral Page`,
                )
              }),
            )
          } else {
            logger.info('[Ref.buyAgencyLisence] No upline to send commision')
          }
          // send mail
          if (profile.User?.email !== null) {
            sendAgencyLicenseMail(
              profile.User?.email,
              profile.User?.username,
              `${process.env.OFFICIAL_PAGE}/r/${profile.ref_code}`,
            )
          }
          pushNotication('AGENCY', ctx)
          ctx.pubsub?.publish('buy-agency', {
            user: profile.User?.username,
            ref: ref?.Sponsor?.username || '',
          })
          // console.log('result: ', result)
          return agencyTransaction
        } catch (err) {
          return err
        } finally {
          lock.unlock().catch(function (err) {
            console.error('lock err: ', err)
          })
        }
      },
    })

    t.field('donation', {
      type: 'Float',
      args: {
        userId: stringArg({ required: true }),
      },
      resolve: async (_, args, ctx) => {
        const userExchangeWallets = await ctx.prisma.exchangeWallet.findMany({
          where: {
            user_id: args.userId,
          },
        })
        const liveWallet = userExchangeWallets.find((i) => i.type === 'MAIN')
        const res = await ctx.prisma.exchangeWalletChange.create({
          data: {
            ExchangeWallet: {
              connect: {
                id: liveWallet.id,
              },
            },
            amount: 10000,
            event_id: '1',
            event_type: 'CONVERT',
          },
        })
        return res.amount
      },
    })
  },
})

export const RefStatsPayload = objectType({
  name: 'RefStatsPayload',
  definition: (t) => {
    t.int('totalReferal')
    t.int('totalAgency')
    t.string('sponsor')
    t.float('tradingCommission')
    t.float('agencyCommision')
    t.int('f1Agencies')
    t.int('f1Users')
    t.float('f1Volume')
    t.float('currentWeekF1Volume')
    t.int('tmpLevel')
  },
})

export const RefNetworkPayload = objectType({
  name: 'RefNetworkPayload',
  definition: (t) => {
    t.int('id')
    t.string('createdAt')
    t.int('sponsor_id')
    t.int('user_id')
    t.int('f')
    t.boolean('isAgency')
    t.float('volume')
    t.int('downlines')
    t.float('com')
    t.string('email')
    t.string('username')
    t.int('agencies')
    t.string('sponsorUsername')
  },
})

export const RefNetworkTreePayload = objectType({
  name: 'RefNetworkTreePayload',
  definition: (t) => {
    t.int('id')
    t.string('createdAt')
    t.int('sponsor_id')
    t.int('user_id')
    t.int('f')
    t.boolean('isAgency')
    t.float('com')
    t.string('username')
    t.string('sponsorUsername')
    t.int('level')
  },
})

export const RefQuery = extendType({
  type: 'Query',
  definition: (t) => {
    t.field('userRefStats', {
      type: 'RefStatsPayload',
      resolve: async (_, args, ctx) => {
        const user = await ctx.prisma.user.findUnique({
          where: {
            id: ctx.user,
          },
          select: {
            UserProfile: true,
          },
        })

        const isKeepRefLevel = user.UserProfile.is_keep_ref_level

        const refs = await ctx.prisma.ref.findMany({
          where: {
            sponsor_id: ctx.user,
          },

          select: {
            user_id: true,
            RefTransaction: true,
            User: {
              select: {
                Order: {
                  select: {
                    bet_amount: true,
                  },
                },
                UserProfile: {
                  select: {
                    is_agency: true,
                  },
                },
              },
            },
          },
        })

        const f1Count = refs.length
        const refsUser = refs.map((i) => i.user_id)
        const f1AgencyP = await Promise.all(
          refsUser.map((i) => isAgency(i, ctx.prisma)),
        )
        const f1Agency = f1AgencyP.filter(Boolean).length

        const f1Volume = await getF1Volume(
          refsUser,
          isKeepRefLevel,
          false,
          ctx.prisma,
        )
        const currentWeekF1Volume = await getF1Volume(
          refsUser,
          isKeepRefLevel,
          true,
          ctx.prisma,
        )

        const agencyCommision = refs.reduce((acc, curr) => {
          const transactions = curr.RefTransaction
          const refVolume = transactions.reduce((a, c) => {
            if (c.event_type === 'AGENCY') {
              return math.add(a, c.earned).toNumber()
            } else {
              return a
            }
          }, 0)
          return math.add(acc, refVolume).toNumber()
        }, 0)
        const tradingCommission = refs.reduce((acc, curr) => {
          const transactions = curr.RefTransaction
          const refVolume = transactions.reduce((a, c) => {
            if (c.event_type === 'TRADING') {
              return math.add(a, c.earned).toNumber()
            } else {
              return a
            }
          }, 0)
          return math.add(acc, refVolume).toNumber()
        }, 0)

        const totalAgency = refs.reduce((acc, curr) => {
          const isAgency = curr.User.UserProfile.is_agency
          if (isAgency) {
            return acc + 1
          } else {
            return acc
          }
        }, 0)

        const userRef = await ctx.prisma.ref.findFirst({
          where: {
            user_id: ctx.user,
          },
          select: {
            Sponsor: true,
          },
        })

        return {
          sponsor: userRef?.Sponsor.username || 'No sponsor',
          totalReferal: f1Count,
          totalAgency,
          tradingCommission,
          agencyCommision,
          f1Agencies: f1Agency,
          f1Users: f1Count,
          f1Volume,
          currentWeekF1Volume,
          tmpLevel: user.UserProfile.admin_config_ref_level || 0,
        }
      },
    })

    t.list.field('userCommissions', {
      type: 'RefTransaction',
      args: {
        skip: intArg(),
        limit: intArg({ default: 10 }),
        type: arg({ type: 'RefTransactionEventType' }),
      },
      resolve: async (_, { limit, skip, type }, ctx) => {
        const refTx = await ctx.prisma.refTransaction.findMany({
          where: {
            sponsor_id: ctx.user,
            event_type: type,
          },
          include: {
            RefLevel: true,
            User: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: limit,
          skip: skip,
        })

        const result = refTx.map((i) => ({
          ...i,
          username: i.User.username,
        }))
        return result
      },
    })

    t.list.field('userCommissionsCustom', {
      type: 'RefTransactionCustom',
      args: {
        sponsorId: stringArg(),
      },
      resolve: async (_, { sponsorId }, ctx) => {
        const result = await ctx.prisma.$queryRaw<any>(
          Prisma.sql`
            WITH RECURSIVE boss AS (
              SELECT id, user_id, sponsor_id, 1 AS level
              FROM "ref"
              WHERE "ref".sponsor_id = ${sponsorId ?? ctx.user}
            UNION ALL
              SELECT r.id, r.user_id, r.sponsor_id, b.level + 1 AS level
              FROM "ref" r
              JOIN boss b ON r.sponsor_id = b.user_id
          )

          SELECT 
            boss.level,
            ref_level."name" AS level_name,
            ref_level.trading_com_rate,
            COALESCE(SUM(ref_transaction.amount), 0) AS volume,
            COALESCE(SUM(ref_transaction.earned), 0) AS commission,
            count(DISTINCT boss.user_id)
          FROM boss
          LEFT JOIN "user" ON "user".id = boss.user_id
          LEFT JOIN "user" AS sps ON sps.id = boss.sponsor_id
          LEFT JOIN ref_transaction ON ref_transaction.ref_id = boss.id AND ref_transaction.event_type = 'TRADING'
          LEFT JOIN ref_level ON ref_level."level" = boss.level
          GROUP BY boss.level, ref_level.name, ref_level.trading_com_rate
          ORDER BY "level" ASC
          `,
        )

        return result.map((i) => {
          return {
            level: i.level_name,
            percentVolume: i.trading_com_rate,
            agencyF1: i.count,
            branchVolume: i.volume,
            commission: i.commission,
          }
        })
      },
    })

    t.list.field('refLevels', {
      type: 'RefLevel',
      resolve: (_, args, ctx) => {
        return ctx.prisma.refLevel.findMany()
      },
    })

    t.list.field('refNetworkTree', {
      type: 'RefNetworkTreePayload',
      args: {
        level: intArg({ required: true, default: 1 }),
        // email: stringArg(),
      },
      resolve: async (_, args, ctx) => {
        let data = await getREFNetwork(ctx.user, args.level, ctx.prisma)

        const networkData = await getRefNetworkTreeData(
          ctx.user,
          data,
          ctx.prisma,
        )

        return networkData
      },
    })

    t.field('refChart', {
      type: 'RefChartPayload',
      resolve: async (_, args, ctx) => {
        const refs = await ctx.prisma.ref.findMany({
          where: {
            sponsor_id: ctx.user,
          },
        })

        const agencies = await ctx.prisma.userProfile.findMany({
          where: {
            user_id: {
              in: refs.map((i) => i.id),
            },
            is_agency: true,
          },
        })

        const commissions = await ctx.prisma.refTransaction.findMany({
          where: {
            ref_id: {
              in: refs.map((i) => i.id),
            },
          },
        })

        logger.info(
          `[Ref.chart] refs: ${refs.length} agencies: ${agencies.length}`,
        )

        return { refs, agencies: agencies, commissions }
      },
    })
  },
})
