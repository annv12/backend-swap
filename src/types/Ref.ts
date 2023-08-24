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

// export const AgencyLicenceTransaction = objectType({
//   name: 'AgencyLicenceTransaction',
//   definition: (t) => {
//     t.model.id()
//     t.model.createdAt()
//     t.model.amount()
//     t.model.user_id()
//   },
// })

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
