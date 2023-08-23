import {
  objectType,
  extendType,
  booleanArg,
  stringArg,
  arg,
  floatArg,
} from 'nexus'
import logger from '../lib/logger'
import path from 'path'
import { uploadFile, validateFileTypeFromStream } from '../lib/upload-util'
import { ValidationError } from '../lib/error-util'

export const User = objectType({
  name: 'User',
  // node: 'id',
  definition(t) {
    // t.implements('Node')
    t.model.id()
    t.model.name()
    t.model.email()
    t.model.username()
    t.model.createdAt()
    t.model.UserProfile()
    t.model.Ref()
    t.model.role()
    t.model.permissions()
    t.field('is_expert', {
      type: 'Boolean',
      resolve: async (root, args, ctx) => {
        const r = await ctx.prisma.tradingExpertRegister.findUnique({
          where: { user_id: ctx.user },
        })
        return (
          r?.approved_status === 'APPROVED' || r?.approved_status === 'PAUSE'
        )
      },
    })
    t.field('expertStatus', {
      type: 'TradingExpertRegisterStatus',
      nullable: true,
      resolve: async (root, args, ctx) => {
        const r = await ctx.prisma.tradingExpertRegister.findUnique({
          where: { user_id: ctx.user },
        })
        return r?.approved_status
      },
    })
    t.model.UserBotAirdrop()
    t.model.ip()
    // t.field('is_premium_account', {
    //   type: 'Boolean',
    //   resolve: async (root, args, ctx) => {
    //     const r = await ctx.prisma.serviceSubscription.findMany({
    //       where: {
    //         user_id: ctx.user,
    //         end_time: {
    //           gte: new Date(),
    //         },
    //       },
    //     })

    //     return r.length > 0
    //   },
    // })
  },
})

export const UserProfile = objectType({
  name: 'UserProfile',
  definition: (t) => {
    t.model.id()
    t.model.createdAt()
    t.model.updatedAt()
    t.model.is_agency()
    t.model.is_keep_ref_level()
    t.model.isEnableInternalTransfer()
    t.model.is_notify_newsletter()
    t.model.ref_code()
    t.model.status()
    t.model.user_id()
    t.model.bio()
    t.model.avatar()
    t.model.profit_sharing()
  },
})

export const UserMutation = extendType({
  type: 'Mutation',
  definition: (t) => {
    t.field('updateProfile', {
      type: 'UserProfile',
      args: {
        isNotifyNewsletter: booleanArg(),
        name: stringArg(),
        bio: stringArg(),
        profitSharing: floatArg(),
      },
      resolve: async (
        _,
        { isNotifyNewsletter, name, bio, profitSharing },
        ctx,
      ) => {
        const profiles = await ctx.prisma.userProfile.findMany({
          where: {
            user_id: ctx.user,
          },
        })
        const profile = profiles[0]

        if (!profile) throw Error('Cannot find user profile please login again')

        if (name) {
          logger.info(`[UPDATE PROFILE] update name: ${name}`)
          await ctx.prisma.user.update({
            where: {
              id: ctx.user,
            },
            data: {
              name,
            },
          })
        }
        if (
          profitSharing != null &&
          (profitSharing <= 0 || profitSharing > 1)
        ) {
          throw new ValidationError({
            message: ctx.i18n.__('Profit sharing not valid'),
          })
        }
        return ctx.prisma.userProfile.update({
          where: {
            id: profile.id,
          },
          data: {
            is_notify_newsletter: isNotifyNewsletter,
            bio,
            profit_sharing: profitSharing,
          },
        })
      },
    })

    t.field('uploadAvatar', {
      type: 'UploadFile',
      args: {
        file: arg({ type: 'Upload', required: true }),
      },
      resolve: async (_, { file }, ctx) => {
        const { createReadStream, filename, mimetype, encoding } = await file
        if (!filename) {
          throw Error('Invalid file Stream')
        }

        await validateFileTypeFromStream(createReadStream)

        // const ext = filename.split('.').pop()
        const ext = path.extname(filename)
        const user = await ctx.prisma.user.findUnique({
          where: { id: ctx.user },
        })
        const PROJECT_ID = process.env.PROJECT_ID
        if (!PROJECT_ID) {
          throw new ValidationError({ message: `PROJECT_ID env not set` })
        }
        const filePath = `${PROJECT_ID}/upload/avatar/${user.username}${ext}`

        const uploadedFileUri = await uploadFile(createReadStream, filePath)

        await ctx.prisma.userProfile.update({
          where: {
            user_id: ctx.user,
          },
          data: {
            avatar: uploadedFileUri,
          },
        })
        logger.info(`User ${user.username} upload a avatar: ${uploadedFileUri}`)

        return {
          filename: filePath,
          uri: uploadedFileUri,
        }
      },
    })
  },
})
