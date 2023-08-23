import { objectType, extendType, intArg, arg, stringArg } from 'nexus'

export const Notification = objectType({
  name: 'Notification',
  definition: (t) => {
    t.model.id()
    t.model.createdAt()
    t.model.updatedAt()
    t.model.title()
    t.model.description()
    t.model.content()
    t.model.type()
    t.model.user_id()
    t.model.User()
  },
})
export const Device = objectType({
  name: 'Device',
  definition: (t) => {
    t.model.id()
    t.model.createdAt()
    t.model.updatedAt()
    t.model.token()
    t.model.platform()
    t.model.version()
    t.model.model()
    t.model.enable()
    t.model.user_id()
    t.model.User()
  },
})

export const NotificationAggregate = objectType({
  name: 'NotificationAggregate',
  definition: (t) => {
    t.int('count')
  },
})

export const noticeMut = extendType({
  type: 'Mutation',
  definition: (t) => {
    t.field('registerDevice', {
      type: 'Boolean',
      args: {
        token: stringArg({ required: true }),
        platform: arg({ type: 'Platform', required: true }),
        version: stringArg(),
        model: stringArg(),
      },
      resolve: async (parent, { token, platform, version, model }, ctx) => {
        // disable other token on same device
        await ctx.prisma.device.updateMany({
          where: {
            token: token,
          },
          data: {
            enable: false,
          },
        })

        // update for user
        let devices = await ctx.prisma.device.findMany({
          where: {
            token,
            user_id: ctx.user,
          },
        })
        if (devices && devices.length > 0) {
          // update info
          await ctx.prisma.device.update({
            where: {
              id: devices[0].id,
            },
            data: {
              enable: true,
              platform,
              version,
              model,
            },
          })
        } else {
          await ctx.prisma.device.create({
            data: {
              token,
              enable: true,
              platform,
              version,
              model,
              User: {
                connect: {
                  id: ctx.user,
                },
              },
            },
          })
        }

        return true
      },
    })

    t.field('readAllNotify', {
      type: 'Boolean',
      resolve: async (parent, arg, ctx) => {
        await ctx.prisma.notification.updateMany({
          where: {
            user_id: ctx.user,
            readed: null,
          },
          data: {
            readed: true,
          },
        })
        return true
      },
    })
  },
})

export const noticeQuery = extendType({
  type: 'Query',
  definition: (t) => {
    t.list.field('notifications', {
      type: 'Notification',
      args: {
        skip: intArg(),
        limit: intArg({ default: 10 }),
      },
      resolve: async (parent, { skip, limit }, ctx) => {
        const notifications = await ctx.prisma.notification.findMany({
          where: {
            user_id: ctx.user,
          },
          take: limit,
          skip: skip,
          orderBy: {
            createdAt: 'desc',
          },
        })
        return notifications
      },
    })

    t.field('notificationAggreagte', {
      type: 'NotificationAggregate',
      args: {},
      resolve: async (_, arg, ctx) => {
        const count = await ctx.prisma.notification.count({})
        return { count }
      },
    })

    t.field('unreadNotifyCount', {
      type: 'Int',
      resolve: async (parent, arg, ctx) => {
        const count = await ctx.prisma.notification.count({
          where: {
            user_id: ctx.user,
            readed: null,
          },
        })
        return count
      },
    })
  },
})
