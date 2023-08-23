// import {
//   arg,
//   enumType,
//   extendType,
//   intArg,
//   objectType,
//   stringArg,
// } from 'nexus'
// import { addDays } from 'date-fns'
// import logger from '../lib/logger'
// import { ValidationError } from '../lib/error-util'
// import { getExchangeWalletBalance } from '../utils'
// import { pushNotication } from '../lib/notify-utils'
// import { parse } from 'path'

// export const ServiceSubscription = objectType({
//   name: 'ServiceSubscription',
//   definition: (t) => {
//     t.model.id()
//     t.model.createdAt()
//     t.model.plan_id()
//     t.model.Plan()
//     t.model.status()
//     t.model.start_time()
//     t.model.end_time()
//     t.model.duration()
//   },
// })

// export const ServiceSubscriptionDurationEnum = enumType({
//   name: 'ServiceSubscriptionDurationEnum',
//   members: ['MONTHLY', 'ANUAL', 'HALF_YEAR', 'QUARTER'],
// })

// // export enum ServiceSubscriptionDuration {
// //   MONTHLY = 'MONTHLY',
// //   ANUAL = 'ANUAL',
// //   HALF_YEAR = 'HALF_YEAR',
// // }

// export const ServiceSubscriptionMutation = extendType({
//   type: 'Mutation',
//   definition: (t) => {
//     t.field('serviceSubscription', {
//       type: 'ServiceSubscription',
//       args: {
//         planId: stringArg({ required: false }),
//         duration: arg({
//           required: true,
//           type: 'ServiceSubscriptionDurationEnum',
//         }),
//       },
//       resolve: async (_, { planId, duration }, ctx) => {
//         const lock = await ctx.redlock.lock(
//           `lock:subscription:${ctx.user}`,
//           3000,
//         )

//         try {
//           const userWallets = await ctx.prisma.exchangeWallet.findMany({
//             where: {
//               user_id: ctx.user,
//               type: 'MAIN',
//             },
//           })

//           const userMainWallet = userWallets[0]
//           const userMainWalletBalance = await getExchangeWalletBalance(
//             userMainWallet,
//             ctx.prisma,
//           )

//           const plan = await ctx.prisma.plan.findFirst()

//           if (!plan) {
//             throw new ValidationError({
//               message: ctx.i18n.__(`Plan not found`),
//             })
//           }

//           const subscriptionAmount =
//             duration === 'MONTHLY'
//               ? plan.price_per_month
//               : duration === 'QUARTER'
//               ? plan.price_per_quarter
//               : duration === 'HALF_YEAR'
//               ? plan.price_half_year
//               : plan.price_per_year

//           if (userMainWalletBalance < subscriptionAmount) {
//             throw new ValidationError({
//               message: ctx.i18n.__(`Balance not enough`),
//             })
//           }

//           const hasSubscriptions = await ctx.prisma.serviceSubscription.findMany(
//             {
//               where: {
//                 user_id: ctx.user,
//               },
//               take: 1,
//             },
//           )
//           const hasSubscription = hasSubscriptions[0]

//           const daysAddMore =
//             duration === 'MONTHLY'
//               ? 30
//               : duration === 'QUARTER'
//               ? 120
//               : duration === 'HALF_YEAR'
//               ? 180
//               : 365

//           let dayExpire = addDays(new Date(), daysAddMore)

//           if (hasSubscription) {
//             if (hasSubscription.end_time >= new Date()) {
//               // exist time, not expired so add more time
//               dayExpire = addDays(hasSubscription.end_time, daysAddMore)
//             }
//             const sub = await ctx.prisma.serviceSubscription.update({
//               where: { id: hasSubscription.id },
//               data: {
//                 Plan: {
//                   connect: {
//                     id: plan.id,
//                   },
//                 },
//                 status: 'ACTIVE',
//                 start_time: new Date(),
//                 end_time: dayExpire,
//                 duration,
//               },
//             })

//             const tx = await ctx.prisma.subscriptionTransaction.create({
//               data: {
//                 Subscription: {
//                   connect: { id: hasSubscription.id },
//                 },
//                 User: { connect: { id: ctx.user } },
//                 amount: subscriptionAmount,
//               },
//             })

//             const walletChange = await ctx.prisma.exchangeWalletChange.create({
//               data: {
//                 ExchangeWallet: { connect: { id: userMainWallet.id } },
//                 amount: -subscriptionAmount,
//                 event_id: tx.id,
//                 event_type: 'SERVICE_SUBSCRIPTION',
//               },
//             })
//             const monthsAddMore =
//               duration === 'MONTHLY'
//                 ? 1
//                 : duration === 'QUARTER'
//                 ? 4
//                 : duration === 'HALF_YEAR'
//                 ? 6
//                 : 12
//             pushNotication(
//               'UPGRADE',
//               ctx,
//               null,
//               `You have completed purchasing the packet that is invalid for [${monthsAddMore}] months. Now you can copy orders from any experts and enjoy the unlimited passive income.

// If this activity is not your own, please contact us immediately.`,
//             )

//             return sub
//           }

//           // crete new subscription
//           const subscription = await ctx.prisma.serviceSubscription.create({
//             data: {
//               Plan: {
//                 connect: {
//                   id: plan.id,
//                 },
//               },
//               User: {
//                 connect: {
//                   id: ctx.user,
//                 },
//               },
//               start_time: new Date(),
//               end_time: dayExpire,
//               status: 'ACTIVE',
//               duration,
//             },
//           })

//           const tx = await ctx.prisma.subscriptionTransaction.create({
//             data: {
//               Subscription: {
//                 connect: { id: subscription.id },
//               },
//               User: { connect: { id: ctx.user } },
//               amount: subscriptionAmount,
//             },
//           })

//           const walletChange = await ctx.prisma.exchangeWalletChange.create({
//             data: {
//               ExchangeWallet: { connect: { id: userMainWallet.id } },
//               amount: -subscriptionAmount,
//               event_id: tx.id,
//               event_type: 'SERVICE_SUBSCRIPTION',
//             },
//           })

//           const monthsAddMore =
//             duration === 'MONTHLY'
//               ? 1
//               : duration === 'QUARTER'
//               ? 4
//               : duration === 'HALF_YEAR'
//               ? 6
//               : 12
//           pushNotication(
//             'UPGRADE',
//             ctx,
//             null,
//             `You have completed purchasing the packet that is valid for [${monthsAddMore}] months. Now you can copy orders from any experts and enjoy the unlimited passive income.

// If this activity is not your own, please contact us immediately.`,
//           )

//           return subscription
//         } catch (err) {
//           return err
//         } finally {
//           lock.unlock().catch(function (err) {
//             logger.error('lock err: ', err)
//             return err
//           })
//         }
//       },
//     })

//     t.field('cancelSubscription', {
//       type: 'ServiceSubscription',
//       resolve: async (_, args, ctx) => {
//         const subscriptions = await ctx.prisma.serviceSubscription.findMany({
//           where: {
//             user_id: ctx.user,
//           },
//           take: 1,
//         })
//         const subscription = subscriptions[0]

//         if (!subscription) {
//           throw new ValidationError({
//             message: ctx.i18n._(`subscription not found`),
//           })
//         }

//         const cancelled = await ctx.prisma.serviceSubscription.update({
//           where: {
//             id: subscription.id,
//           },
//           data: {
//             status: 'CANCELED',
//           },
//         })

//         return cancelled
//       },
//     })
//   },
// })

// export const ServiceSubscriptionQuery = extendType({
//   type: 'Query',
//   definition: (t) => {
//     t.field('userServiceSubscription', {
//       type: 'ServiceSubscription',
//       nullable: true,
//       resolve: async (_, args, ctx) => {
//         const subscriptions = await ctx.prisma.serviceSubscription.findMany({
//           where: {
//             user_id: ctx.user,
//           },
//           take: 1,
//         })
//         const subscription = subscriptions[0]

//         return subscription
//       },
//     })
//   },
// })
