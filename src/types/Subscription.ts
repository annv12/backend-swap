import { subscriptionField, objectType } from 'nexus'
import logger from '../lib/logger'

export const Foo = objectType({
  name: 'Foo',
  definition(t) {
    t.float('date')
    t.float('open')
    t.float('high')
    t.float('low')
    t.float('close')
    t.boolean('f')
    t.int('countDown')
  },
})

export const Subscription = subscriptionField('candleStick', {
  type: 'Foo',
  subscribe: async (root, args, ctx) => {
    return ctx.pubsub.asyncIterator('candlestick')
  },
  // @ts-ignore
  resolve(payload) {
    if (payload) return payload
  },
})

export const clockSubscriptionPayload = objectType({
  name: 'ClockSubscriptionPayload',
  definition: (t) => {
    t.boolean('enable')
    t.int('countDown')
  },
})

export const clockSubscription = subscriptionField('clock', {
  type: 'ClockSubscriptionPayload',
  subscribe: async (_, args, ctx) => {
    return ctx.pubsub.asyncIterator('clock-machine')
  },
  resolve: (payload) => {
    if (payload) return payload
  },
})

export const userOpinionSubscription = subscriptionField('userOpinion', {
  type: 'Int',
  subscribe: async (_, args, ctx) => {
    return ctx.pubsub.asyncIterator('user-opinion')
  },
  resolve: (payload: any) => payload,
})

export const battleRoundNumberSubscription = subscriptionField(
  'battleRoundNumber',
  {
    type: 'Int',
    subscribe: async (_, args, ctx) => {
      return ctx.pubsub.asyncIterator('battle-round-number')
    },
    resolve: (payload: any) => payload,
  },
)

export const battleGiftCodeSubscription = subscriptionField('battleGiftCode', {
  type: 'String',
  subscribe: async (_, args, ctx) => {
    return ctx.pubsub.asyncIterator('battle-gift-code')
  },
  resolve: (payload: any) => payload,
})

export const newNotify = subscriptionField('newNotify', {
  type: 'Notification',
  subscribe: async (_, args, ctx) => {
    return ctx.pubsub.asyncIterator(`new-notify.${ctx.user}`)
  },
  resolve: (payload: any) => payload,
})

// export const currentRound = subscriptionField('adminRoundTracking', {
//   type: 'AdminRoundTracking',
//   list: true,
//   subscribe: async (_, args, ctx) => {
//     return ctx.pubsub.asyncIterator(`round-result-admin`)
//   },
//   resolve: (payload: any) => payload,
// })

// export const insuranceSubscriptionPayload = objectType({
//   name: 'InsuranceSubscriptionPayload',
//   definition: (t) => {
//     t.boolean('is_enable')
//     t.int('round')
//   },
// })

// export const insuranceSubscription = subscriptionField('insuranceInfo', {
//   type: 'InsuranceSubscriptionPayload',
//   subscribe: async (_, args, ctx) => {
//     return ctx.pubsub.asyncIterator('insurance-info')
//   },
//   resolve: (payload) => {
//     if (payload) return payload
//   },
// })

export const PoolInfoPayload = objectType({
  name: 'PoolInfo',
  definition: (t) => {
    t.float('totalBetAmount')
    t.float('totalWinAmount')
    t.float('totalInSurance')
    t.float('totalCut')
  },
})

export const adminPoolInfoSubscription = subscriptionField('adminPoolInfo', {
  type: 'PoolInfo',
  subscribe: async (_, args, ctx) => {
    return ctx.pubsub.asyncIterator('pool-info')
  },
  resolve: (payload) => {
    if (payload) return payload
  },
})

export const refundSubscriptionPayload = objectType({
  name: 'RefundSubscriptionPayload',
  definition: (t) => {
    t.float('amount')
  },
})

export const refundSubscription = subscriptionField('refundSubscription', {
  type: 'RefundSubscriptionPayload',
  subscribe: async (_, args, ctx) => {
    return ctx.pubsub.asyncIterator(`user-refund.${ctx.user}`)
  },
  resolve: (payload: any) => {
    logger.info('user-refund subscription payload', payload)
    if (payload) return payload
  },
})
