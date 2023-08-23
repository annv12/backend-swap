// import { intArg, queryField } from 'nexus'

// export const AdminOrder = queryField('adminOrder', {
//   type: 'Order',
//   args: {
//     roundId: intArg({ required: false }),
//     skip: intArg({ required: false }),
//     limit: intArg({ required: false, default: 10 }),
//   },
//   resolve: async (_, args, ctx) => {
//     const orders = await ctx.prisma.order.findMany({
//       where: {
//         round_id: args.roundId,
//       },
//       skip: args.skip,
//       take: args.limit,
//       orderBy: {
//         createdAt: 'desc',
//       },
//       include: {
//         OrderResult: true,
//       }
//     })

//     return orders
//   },
// })
