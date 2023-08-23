import {
  objectType,
  extendType,
  intArg,
  stringArg,
  floatArg,
  arg,
  enumType,
} from 'nexus'
import { getOrderByQuery } from '../../lib/utils'
import { ValidationError } from '../../lib/error-util'
import { checkPermissions } from '../../lib/auth-utils'
import { sendPushNotication } from '../../lib/notify-utils'

export const NotificationPagination = objectType({
  name: 'NotificationPagination',
  definition: (t) => {
    t.list.field('nodes', {
      type: 'Notification',
      nullable: true,
    })
    t.int('total')
  },
})

export const NotificationCategory = enumType({
  name: 'NotificationCategory',
  members: ['AGENCY', 'STAFF'],
})

export const adNotificationQuery = extendType({
  type: 'Query',
  definition: (t) => {
    t.field('adNotifications', {
      type: 'NotificationPagination',
      args: {
        skip: intArg({ default: 0 }),
        limit: intArg({ default: 10 }),
        search: stringArg({ nullable: true }),
        orderBy: stringArg({ nullable: true }),
      },
      resolve: async (parent, { skip, limit, search, orderBy }, ctx) => {
        const { orderByField, order } = getOrderByQuery(
          orderBy,
          'createdAt desc',
        )

        const nodes = await ctx.prisma.notification.findMany({
          skip,
          take: limit,
          orderBy: {
            [orderByField]: order,
          },
        })
        const total = await ctx.prisma.mainWalletChange.count()
        return {
          nodes,
          total,
        }
      },
    })
  },
})

export const adNotificationMut = extendType({
  type: 'Mutation',
  definition: (t) => {
    t.field('pushNotification', {
      type: 'Boolean',
      args: {
        title: stringArg({ nullable: false }),
        body: stringArg({ nullable: false }),
        type: arg({ type: 'NotificationCategory', nullable: true }),
      },
      resolve: async (parent, { title, body, type }, ctx) => {
        let userCondition: any = {
          UserProfile: {
            is_agency: true,
            status: 'NORMAL',
          },
        }
        if (type == 'STAFF') {
          userCondition = {
            UserProfile: {
              status: 'NORMAL',
            },
            role: 'STAFF',
          }
        }

        const devices = await ctx.prisma.device.findMany({
          where: {
            User: userCondition,
          },
        })
        // console.log('devices: ', devices)
        if (devices.length > 0) {
          const result = await sendPushNotication(
            title,
            body,
            type,
            devices.map((item) => item.token),
          )
          console.log('Send push notification admin result: ', result)

          let users = await ctx.prisma.user.findMany({
            where: userCondition,
          })
          // console.log('users: ', users)

          let pmNotifications = []
          for (let item of users) {
            pmNotifications.push(
              ctx.prisma.notification.create({
                data: {
                  User: {
                    connect: {
                      id: item.id,
                    },
                  },
                  content: body,
                  title,
                  description: body,
                  type: 'CAMPAIGN',
                },
              }),
            )
          }
          let notices = await Promise.all(pmNotifications)
          // console.log('notices: ', notices)
        }
        return true
      },
    })
  },
})
