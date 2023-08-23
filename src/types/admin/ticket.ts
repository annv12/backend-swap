// import {
//   objectType,
//   extendType,
//   intArg,
//   arg,
//   stringArg,
//   enumType,
// } from 'nexus'
// import { uploadFile, validateTicketFileFromStream } from '../../lib/upload-util'
// import path from 'path'
// // @ts-ignore
// import Slug from 'slugg'
// import { ValidationError } from '../../lib/error-util'
// import { checkPermissions } from '../../lib/auth-utils'

// export const Category = objectType({
//   name: 'TicketCategory',
//   definition: (t) => {
//     t.model.id()
//     t.model.createdAt()
//     t.model.updatedAt()
//     t.model.title()
//     t.model.slug()
//     t.model.description()
//   },
// })

// export const TicketCategoryConnection = objectType({
//   name: 'TicketCategoryConnection',
//   definition: (t) => {
//     t.list.field('nodes', {
//       type: 'TicketCategory',
//       // nullable: true,
//     })
//     t.int('total')
//   },
// })

// export const Ticket = objectType({
//   name: 'Ticket',
//   definition: (t) => {
//     t.model.id()
//     t.model.createdAt()
//     t.model.updatedAt()
//     t.model.User()
//     t.model.title()
//     t.model.content()
//     t.model.note()
//     t.model.Category()
//     t.model.status()
//     t.model.priority()
//     t.model.category_id()
//     t.model.Reply()
//     // t.list.field('Reply', {
//     //   type: 'Reply',
//     //   resolve: async (parent, arg, ctx) => {
//     //     let result = await ctx.prisma.reply.findMany({
//     //       where: {
//     //         ticket_id: parent.id,
//     //       },
//     //       orderBy: {
//     //         createdAt: 'desc',
//     //       },
//     //     })
//     //     return result
//     //   },
//     // })
//     t.model.files()
//   },
// })

// export const Reply = objectType({
//   name: 'Reply',
//   definition: (t) => {
//     t.model.id()
//     t.model.createdAt()
//     t.model.updatedAt()
//     t.model.User()
//     t.model.Ticket()
//     t.model.content()
//     t.model.files()
//   },
// })

// export const TicketConnection = objectType({
//   name: 'TicketConnection',
//   definition: (t) => {
//     t.list.field('nodes', {
//       type: 'Ticket',
//       nullable: true,
//     })
//     t.int('total')
//   },
// })
// export const ReplyConnection = objectType({
//   name: 'ReplyConnection',
//   definition: (t) => {
//     t.list.field('nodes', {
//       type: 'Reply',
//       nullable: true,
//     })
//     t.int('total')
//   },
// })

// export const ticketQuery = extendType({
//   type: 'Query',
//   definition: (t) => {
//     t.field('ticketCategories', {
//       type: 'TicketCategoryConnection',
//       args: {
//         skip: intArg(),
//         limit: intArg({ default: 10 }),
//       },
//       resolve: async (_, { skip, limit }, ctx) => {
//         const nodes = await ctx.prisma.ticketCategory.findMany({
//           skip,
//           take: limit,
//           orderBy: {
//             createdAt: 'desc',
//           },
//         })
//         const total = await ctx.prisma.ticketCategory.count()
//         return {
//           nodes,
//           total,
//         }
//       },
//     })

//     t.field('ticket', {
//       type: 'Ticket',
//       args: {
//         ticket_id: stringArg({ nullable: true }),
//       },
//       resolve: async (_, { ticket_id }, ctx) => {
//         const ticket = await ctx.prisma.ticket.findUnique({
//           where: {
//             id: ticket_id,
//           },
//         })
//         if (ctx.role === 'TRADER' && ticket.user_id !== ctx.user) {
//           throw new ValidationError({
//             message: ctx.i18n.__('Not have permission'),
//           })
//         } else if (ctx.role !== 'TRADER') {
//           await checkPermissions(ctx, ['CAN_VIEW_TICKET'])
//         }
//         return ticket
//       },
//     })

//     t.field('tickets', {
//       type: 'TicketConnection',
//       args: {
//         skip: intArg(),
//         limit: intArg({ default: 10 }),
//         ticket_id: stringArg({ nullable: true }),
//         user_id: stringArg({ nullable: true }),
//         assigned: intArg({ nullable: true }),
//         status: arg({ type: 'TicketStatus', nullable: true }),
//       },
//       resolve: async (
//         _,
//         { skip, limit, ticket_id, user_id, status, assigned },
//         ctx,
//       ) => {
//         let where: any = {
//           id: ticket_id,
//           user_id,
//           status,
//           assigned,
//         }
//         if (ctx.role === 'TRADER') {
//           // get only user's tickets
//           where = {
//             ...where,
//             user_id: ctx.user,
//           }
//         } else {
//           await checkPermissions(ctx, ['CAN_VIEW_TICKET'])
//         }
//         const nodes = await ctx.prisma.ticket.findMany({
//           where,
//           skip,
//           take: limit,
//           orderBy: {
//             createdAt: 'desc',
//           },
//         })
//         const total = await ctx.prisma.ticket.count({
//           where,
//         })
//         return {
//           nodes,
//           total,
//         }
//       },
//     })
//   },
// })

// export const TicketStatus = enumType({
//   name: 'TicketStatus',
//   members: ['PENDING', 'OPEN', 'SOLVED', 'CLOSED'],
// })
// // export const TicketPriority = enumType({
// //   name: 'TicketPriority',
// //   members: ['LOW', 'NORMAL', 'HIGH'],
// // })

// export const ticketMut = extendType({
//   type: 'Mutation',
//   definition: (t) => {
//     t.field('createCategory', {
//       type: 'TicketCategory',
//       args: {
//         title: stringArg(),
//         description: stringArg({ nullable: true }),
//       },
//       resolve: async (_, { title, description }, ctx) => {
//         await checkPermissions(ctx, ['CAN_MANAGE_CATEGORY'])
//         const slug = Slug(title)
//         const data = await ctx.prisma.ticketCategory.create({
//           data: {
//             title,
//             slug,
//             description,
//           },
//         })
//         return data
//       },
//     })

//     t.field('updateCategory', {
//       type: 'TicketCategory',
//       args: {
//         category_id: stringArg(),
//         title: stringArg(),
//         description: stringArg({ nullable: true }),
//       },
//       resolve: async (_, { title, category_id, description }, ctx) => {
//         await checkPermissions(ctx, ['CAN_MANAGE_CATEGORY'])
//         const slug = Slug(title)
//         const data = await ctx.prisma.ticketCategory.update({
//           where: {
//             id: category_id,
//           },
//           data: {
//             title,
//             slug,
//             description,
//           },
//         })
//         return data
//       },
//     })

//     t.field('createTicket', {
//       type: 'Ticket',
//       args: {
//         category_id: stringArg(),
//         title: stringArg(),
//         content: stringArg(),
//         note: stringArg({ nullable: true }),
//         files: arg({ type: 'Upload', list: true, nullable: true }),
//       },
//       resolve: async (_, { category_id, title, content, note, files }, ctx) => {
//         const user_id = ctx.user
//         let fileStrings: string[] = []
//         if (files) {
//           for (let item of files) {
//             const { createReadStream, filename } = await item
//             if (!filename) {
//               throw new ValidationError(ctx.i18n.__('Invalid file Stream'))
//             }

//             await validateTicketFileFromStream(createReadStream)

//             // const ext = filename.split('.').pop()
//             const ext = path.extname(filename)
//             const basename = path.basename(filename, ext)
//             const PROJECT_ID = process.env.PROJECT_ID
//             if (!PROJECT_ID) {
//               throw new ValidationError({ message: `PROJECT_ID env not set` })
//             }
//             let timeStamp = new Date().getTime()
//             const filePath = `${PROJECT_ID}/upload/tickets/${user_id}${basename}${timeStamp}${ext}`

//             const uploadedFileUri = await uploadFile(createReadStream, filePath)
//             fileStrings.push(uploadedFileUri)
//           }
//         }
//         // check exist category_id
//         let category = await ctx.prisma.ticketCategory.findUnique({
//           where: {
//             id: category_id,
//           },
//         })
//         if (!category) {
//           throw new ValidationError(ctx.i18n.__('Ticket category not found'))
//         }
//         const data = await ctx.prisma.ticket.create({
//           data: {
//             Category: {
//               connect: {
//                 id: category_id,
//               },
//             },
//             User: {
//               connect: {
//                 id: user_id,
//               },
//             },
//             title,
//             content,
//             note,
//             files: fileStrings,
//           },
//         })
//         return data
//       },
//     })

//     t.field('updateTicket', {
//       type: 'Ticket',
//       args: {
//         ticket_id: stringArg(),
//         status: arg({ type: 'TicketStatus' }),
//       },
//       resolve: async (_, { ticket_id, status }, ctx) => {
//         let ticket = await ctx.prisma.ticket.findUnique({
//           where: {
//             id: ticket_id,
//           },
//         })
//         if (!ticket) {
//           throw new ValidationError({ message: 'Ticket not found' })
//         }
//         await checkPermissions(ctx, ['CAN_REPLY_TICKET'])
//         if (ctx.role === 'STAFF' && ctx.user !== ticket.assigned) {
//           throw new ValidationError({
//             message: ctx.i18n.__('Not have permission'),
//           })
//         }

//         const data = await ctx.prisma.ticket.update({
//           data: {
//             status,
//           },
//           where: {
//             id: ticket_id,
//           },
//         })
//         return data
//       },
//     })

//     t.field('replyTicket', {
//       type: 'Reply',
//       args: {
//         ticket_id: stringArg(),
//         content: stringArg(),
//         files: arg({ type: 'Upload', list: true, nullable: true }),
//       },
//       resolve: async (_, { ticket_id, content, files }, ctx) => {
//         if (ctx.role !== 'TRADER') {
//           await checkPermissions(ctx, ['CAN_REPLY_TICKET'])
//         }
//         let ticket = await ctx.prisma.ticket.findUnique({
//           where: {
//             id: ticket_id,
//           },
//         })
//         if (!ticket) {
//           throw new ValidationError({
//             message: ctx.i18n.__('Ticket not found'),
//           })
//         }
//         if (ctx.role !== 'TRADER' && !ticket.assigned) {
//           ticket = await ctx.prisma.ticket.update({
//             data: {
//               assigned: ctx.user,
//               status: 'OPEN',
//             },
//             where: {
//               id: ticket_id,
//             },
//           })
//         }
//         let user_id = ctx.user

//         // let staff_id = ticket.staff_id
//         // check permission
//         if (
//           (ctx.role === 'STAFF' &&
//             (ctx.user !== ticket.assigned ||
//               ['SOLVED', 'CLOSED'].includes(ticket.status))) ||
//           (ctx.role === 'TRADER' &&
//             (ctx.user !== ticket.user_id || ticket.status !== 'OPEN'))
//         ) {
//           throw new ValidationError({
//             message: ctx.i18n.__("You can't reply this ticket"),
//           })
//         }
//         // Handler upload
//         let fileStrings: string[] = []
//         if (files) {
//           for (let item of files) {
//             const { createReadStream, filename } = await item
//             if (!filename) {
//               throw new ValidationError({
//                 message: ctx.i18n.__('Invalid file Stream'),
//               })
//             }

//             await validateTicketFileFromStream(createReadStream)

//             // const ext = filename.split('.').pop()
//             const ext = path.extname(filename)
//             const basename = path.basename(filename, ext)
//             const PROJECT_ID = process.env.PROJECT_ID
//             if (!PROJECT_ID) {
//               throw new ValidationError({ message: `PROJECT_ID env not set` })
//             }
//             let timeStamp = new Date().getTime()
//             const filePath = `${PROJECT_ID}/upload/tickets/${user_id}${basename}${timeStamp}${ext}`

//             const uploadedFileUri = await uploadFile(createReadStream, filePath)
//             fileStrings.push(uploadedFileUri)
//           }
//         }

//         const data = await ctx.prisma.reply.create({
//           data: {
//             Ticket: {
//               connect: {
//                 id: ticket_id,
//               },
//             },
//             User: {
//               connect: {
//                 id: user_id,
//               },
//             },
//             content,
//             files: fileStrings,
//           },
//         })
//         return data
//       },
//     })
//   },
// })
