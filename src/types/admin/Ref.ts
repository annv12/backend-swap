import { Prisma } from '@prisma/client'
import { extendType, objectType, queryField, stringArg } from 'nexus'
import logger from '../../lib/logger'
import { ValidationError } from '../../lib/error-util'
import { generateREFNote } from '../../lib/ref-utils'

export const AdminRefLevelsQuery = extendType({
  type: 'Query',
  definition(t) {
    t.crud.refLevels({
      alias: 'adminRefLevels',
    })
  },
})

export const AdminRefLevelsMutation = extendType({
  type: 'Mutation',
  definition(t) {
    t.crud.updateOneRefLevel({
      alias: 'adminUpdateOneRefLevel',
    })
  },
})

export const AdminRefTreePayload = objectType({
  name: 'AdminRefTreePayload',
  definition(t) {
    t.int('id')
    t.string('username')
    t.string('user_id')
    t.string('sponsor_id')
    t.float('volume')
  },
})

export const AdminRefTreeQuery = queryField('adminRefTree', {
  type: 'AdminRefTreePayload',
  list: true,
  args: {
    userId: stringArg({ required: true }),
  },
  async resolve(_, args, ctx) {
    const queryResult = await ctx.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        ref_tree.username,
        ref_tree.user_id,
        ref_tree.sponsor_id,
        COALESCE(SUM(ref_transaction.amount), 0) AS volume
      FROM (WITH RECURSIVE tree (
          id,
          user_id,
          sponsor_id
      ) AS (
          SELECT
            id,
            user_id,
            sponsor_id
          FROM
            "ref"
          WHERE
            "ref"."sponsor_id" = ${args.userId}
          UNION ALL
          SELECT
            rf.id,
            rf.user_id,
            rf.sponsor_id
          FROM
            "ref" rf,
            tree tr
          WHERE
            rf.sponsor_id = tr.user_id
      )
        SELECT
          tree.*,
          "user".username
        FROM
          tree
        LEFT JOIN "user" ON "user".id = tree.user_id
      ) AS ref_tree
        LEFT JOIN ref_transaction ON ref_transaction.user_id = ref_tree.user_id
      GROUP BY
        ref_tree.username,
        ref_tree.user_id,
        ref_tree.sponsor_id
    `)

    return queryResult
  },
})

export const adRefMut = extendType({
  type: 'Mutation',
  definition: (t) => {
    t.field('createRef', {
      type: 'Ref',
      nullable: false,
      args: {
        usernameUser: stringArg({ required: true }),
        refCode: stringArg({ required: true }),
      },
      resolve: async (_, { usernameUser, refCode }, ctx) => {
        usernameUser = usernameUser.toLowerCase()
        // check exist account
        const user = await ctx.prisma.user.findFirst({
          where: {
            username: usernameUser,
          },
        })
        logger.info('[Admin.Ref.createRef] user', user)

        if (!user)
          throw new ValidationError({
            message: ctx.i18n.__('Cannot find user'),
          })

        let sponsor = await ctx.prisma.userProfile.findUnique({
          where: {
            ref_code: refCode,
          },
        })
        logger.info('[Admin.Ref.createRef] Sponsor profile: ', sponsor)

        if (!sponsor)
          throw new ValidationError({
            message: ctx.i18n.__('Cannot find refcode'),
          })

        if (user.id == sponsor.user_id)
          throw new ValidationError({
            message: ctx.i18n.__("You can't create ref yourself"),
          })

        // 🤯
        const refNote = await generateREFNote(sponsor.user_id, ctx.prisma)
        logger.info('[Admin.Ref.createRef] Sponsor list: ', { refNote })

        const refData = await ctx.prisma.ref.create({
          data: {
            User: {
              connect: {
                id: user.id,
              },
            },
            Sponsor: {
              connect: {
                id: sponsor.user_id,
              },
            },
            note: refNote,
          },
        })
        logger.info(`[Admin.Ref.createRef] Ref data: `, refData)
        return refData
      },
    })
  },
})
