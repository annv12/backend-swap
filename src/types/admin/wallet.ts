import { objectType, extendType, intArg, stringArg, floatArg, arg } from 'nexus'
import { getOrderByQuery } from '../../lib/utils'
import { ValidationError } from '../../lib/error-util'
import { checkPermissions } from '../../lib/auth-utils'

export const MainWalletChange = objectType({
  name: 'MainWalletChange',
  definition: (t) => {
    t.model.id()
    t.model.createdAt()
    t.model.updatedAt()
    t.model.main_wallet_id()
    t.model.MainWallet()
    t.model.event_id()
    t.model.event_type()
    t.model.amount()
  },
})

export const mainWalletChangePagination = objectType({
  name: 'MainWalletChangePagination',
  definition: (t) => {
    t.list.field('nodes', {
      type: 'MainWalletChange',
      nullable: true,
    })
    t.int('total')
  },
})

export const adWalletQuery = extendType({
  type: 'Query',
  definition: (t) => {
    t.field('mainWalletChange', {
      type: 'MainWalletChangePagination',
      args: {
        skip: intArg({ default: 0 }),
        limit: intArg({ default: 10 }),
        user_id: stringArg({ nullable: false }),
        currency_id: stringArg({ nullable: true }),
        wallet_id: stringArg({ nullable: true }),
        event_type: arg({ type: 'WalletChangeEventType', nullable: true }),
        search: stringArg({ nullable: true }),
        orderBy: stringArg({ nullable: true }),
      },
      resolve: async (
        parent,
        {
          skip,
          limit,
          wallet_id,
          user_id,
          currency_id,
          event_type,
          search,
          orderBy,
        },
        ctx,
      ) => {
        await checkPermissions(ctx, ['CAN_VIEW_WALLET_CHANGE'])

        const { orderByField, order } = getOrderByQuery(
          orderBy,
          'createdAt desc',
        )
        let where = {
          event_type,
          MainWallet: {
            id: wallet_id,
            user_id,
            currency_id,
            OR: [
              {
                Currency: {
                  symbol: {
                    contains: search,
                  },
                },
              },
              {
                MainWalletAddress: {
                  address: {
                    contains: search,
                  },
                },
              },
            ],
          },
        }
        const nodes = await ctx.prisma.mainWalletChange.findMany({
          where,
          skip,
          take: limit,
          orderBy: {
            [orderByField]: order,
          },
        })
        const total = await ctx.prisma.mainWalletChange.count({
          where,
        })
        return {
          nodes,
          total,
        }
      },
    })
  },
})
