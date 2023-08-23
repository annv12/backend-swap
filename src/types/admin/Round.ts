import { Prisma } from '@prisma/client'
import {
  arg,
  enumType,
  intArg,
  mutationField,
  nonNull,
  objectType,
  queryField,
  stringArg,
  subscriptionField,
} from 'nexus'
import { ValidationError } from '../../lib/error-util'
import { RedisDatabaseKey } from '../../lib/redis-utils'

export const AdminRound = objectType({
  name: 'AdminRound',
  definition(t) {
    t.id('id')
    t.float('open_price')
    t.float('close_price')
    t.field('type', { type: 'RoundType' })
    t.int('time_id')
    t.float('bet_amount')
    t.float('win_amount')
    t.float('profit')
    t.int('order_count')
    t.int('total_bet_up')
    t.int('total_bet_down')
    t.float('total_volume_up')
    t.float('total_volume_down')
  },
})

export const adminRoundQuery = queryField('adminRound', {
  type: AdminRound,
  list: true,
  args: {
    skip: intArg({ nullable: true, default: 0 }),
    limit: intArg({ nullable: true, default: 10 }),
  },
  resolve: async (_, { skip, limit }, ctx) => {
    const rounds = await ctx.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        *
      FROM
        round
        LEFT JOIN (
          SELECT
            SUM("order".bet_amount) AS bet_amount,
            SUM(order_result.win_amount) AS win_amount,
            SUM("order".bet_amount) - SUM(order_result.win_amount) AS profit,
            COUNT("order".id) AS order_count,
            COUNT(CASE WHEN "order".bet_type = 'UP' THEN 1 ELSE null END) AS total_bet_up,
            COUNT(CASE WHEN "order".bet_type = 'DOWN' THEN 1 ELSE null END) AS total_bet_down,
            SUM(CASE WHEN "order".bet_type = 'UP' THEN bet_amount ELSE 0 END) AS total_volume_up,
            SUM(CASE WHEN "order".bet_type = 'DOWN' THEN bet_amount ELSE 0 END) AS total_volume_down,
            "order".round_id
          FROM
            "order"
            LEFT JOIN order_result ON order_result.order_id = "order".id
          GROUP BY
            "order".round_id) uo ON uo.round_id = round.time_id
      ORDER BY time_id DESC
      OFFSET ${skip}
      LIMIT ${limit}
    `)

    return rounds
  },
})

export const adminRoundAggregate = objectType({
  name: 'AdminRoundAggregate',
  definition(t) {
    t.int('count')
  },
})

export const adminRoundAggregateQuery = queryField('adminRoundAggregate', {
  type: 'AdminRoundAggregate',
  args: {},
  resolve: async (_, args, ctx) => {
    const count = await ctx.prisma.round.count()

    return { count }
  },
})

export const adminRoundRequestMutation = mutationField('adminRoundRequest', {
  type: 'Boolean',
  args: {
    type: 'RoundType',
    exchangePairName: nonNull(stringArg()),
  },
  resolve: async (_, args, ctx) => {
    const exchangePair = await ctx.prisma.exchangePair.findFirst({
      where: {
        name: args.exchangePairName,
      },
    })

    if (!exchangePair) {
      throw new ValidationError("Exchange pair doesn't exist")
    }

    try {
      await ctx.redis.set(RedisDatabaseKey.ROUND_DECISION, args.type)
      await ctx.redis.set(RedisDatabaseKey.ROUND_DECISION + '.' + exchangePair.name, args.type)
      await ctx.pubsub?.publish(`round-result`, {
        exchangeName: exchangePair.name,
        type: args.type,
      })
      let count = Number(await ctx.redis.get('COUNT_MANUAL_SET')) || 0 
      await ctx.redis.set('COUNT_MANUAL_SET', count + 1)
      return true
    } catch (error) {
      console.error(error)
      return false
    }
  },
})

export const adminRoundRequestSubscriptionPayload = objectType({
  name: 'AdminRoundRequestSubscriptionPayload',
  definition(t) {
    t.field('decision', { type: 'RoundType' })
  },
})

export const adminRoundRequestSubscription = subscriptionField(
  'adminRoundRequestSubscription',
  {
    type: 'AdminRoundRequestSubscriptionPayload',
    subscribe: async (_, args, ctx) => {
      return ctx.pubsub.asyncIterator(`decision`)
    },
    resolve: (payload: any) => payload,
  },
)

export const TradeMode = enumType({
  name: 'TradeMode',
  members: ['NATURE', 'AUTO_BALANCE', 'AUTO_GAIN', 'AUTO_LOSS', 'NATURE_PLUS'],
})

export const adminTradeModeQuery = queryField('adminTradeMode', {
  type: 'TradeMode',
  args: {},
  resolve: async (_, args, ctx) => {
    const mode: any = await ctx.redis.get(RedisDatabaseKey.TRADE_MODE)
    return mode || 'AUTO_GAIN'
  },
})

export const adminSetTradeModeMutation = mutationField('adminSetTradeMode', {
  type: 'Boolean',
  args: {
    mode: 'TradeMode',
  },
  resolve: async (_, args, ctx) => {
    try {
      await ctx.redis.set(RedisDatabaseKey.TRADE_MODE, args.mode)
      await ctx.pubsub?.publish(`change-mode`, {
        mode: args.mode,
      })
      return true
    } catch (error) {
      console.error(error)
      return false
    }
  },
})

export const RoundChartPayload = objectType({
  name: 'RoundChartPayload',
  definition(t) {
    t.string('date')
    t.float('order_count')
    t.float('total_bet_amount')
    t.float('total_win_amount')
    t.float('profit')
  },
})

export const ChartTimeGroupEnum = enumType({
  name: 'ChartTimeGroupEnum',
  members: ['DAY', 'WEEK', 'MONTH', 'YEAR'],
})

export const RoundChartQuery = queryField('adminRoundChart', {
  type: 'RoundChartPayload',
  list: true,
  args: {
    skip: intArg({ nullable: true, default: 0 }),
    limit: intArg({ nullable: true, default: 10 }),
    timeGroup: arg({ type: 'ChartTimeGroupEnum', default: 'DAY' }),
  },
  resolve: async (_, args, ctx) => {
    let timeGroup = Prisma.sql`DATE_TRUNC('day', round.created_at)`
    switch (args.timeGroup) {
      case 'WEEK':
        timeGroup = Prisma.sql`DATE_TRUNC('week', round.created_at)`
        break
      case 'MONTH':
        timeGroup = Prisma.sql`DATE_TRUNC('month', round.created_at)`
        break
      case 'YEAR':
        timeGroup = Prisma.sql`DATE_TRUNC('year', round.created_at)`
      default:
        break
    }

    const result = await ctx.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        ${timeGroup} AS date,
        COALESCE(SUM(order_count), 0) AS order_count,
        COALESCE(SUM(total_bet_amount), 0) AS total_bet_amount,
        COALESCE(SUM(total_win_amount), 0) AS total_win_amount,
        COALESCE(SUM(profit), 0) AS profit
      FROM
        round
        LEFT JOIN (
        SELECT
          SUM("order".bet_amount) AS total_bet_amount,
          SUM(order_result.win_amount) AS total_win_amount,
          COALESCE(SUM("order".bet_amount) - SUM(order_result.win_amount), 0) AS profit,
          COUNT("order".id) AS order_count,
          "order".round_id
        FROM
          "order"
          LEFT JOIN order_result ON order_result.order_id = "order".id
        GROUP BY
          "order".round_id) uo ON uo.round_id = round.time_id
      GROUP BY
        ${timeGroup}
      ORDER BY
        date DESC
      OFFSET ${args.skip}
      LIMIT ${args.limit}
    `)

    return result
  },
})
