// import { extendType, objectType } from 'nexus'

// // export const Service = objectType({
// //   name: 'Service',
// //   definition: (t) => {
// //     t.model.id()
// //     t.model.createdAt()
// //     t.model.name()
// //     t.model.description()
// //   },
// // })

// export const Plan = objectType({
//   name: 'Plan',
//   definition: (t) => {
//     t.model.id()
//     t.model.createdAt()
//     t.model.name()
//     t.model.description()
//     t.model.price_per_month()
//     t.model.price_per_quarter()
//     t.model.price_half_year()
//     t.model.price_per_year()
//     // t.model.Service()
//   },
// })

// export const PlanQuery = extendType({
//   type: 'Query',
//   definition: (t) => {
//     t.list.field('plans', {
//       type: 'Plan',
//       resolve: async (_, args, ctx) => {
//         const plans = await ctx.prisma.plan.findMany({
//           where: {
//             is_active: true,
//           },
//           // include: {
//           //   Service: true,
//           // },
//         })

//         return plans
//       },
//     })

//     t.field('plan', {
//       type: 'Plan',
//       resolve: async (_, args, ctx) => {
//         const plans = await ctx.prisma.plan.findMany({
//           where: {
//             is_active: true,
//           },
//           // include: {
//           //   Service: true,
//           // },
//           take: 1,
//         })
//         return plans[0]
//       },
//     })
//   },
// })
