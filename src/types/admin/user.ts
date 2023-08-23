import {
  objectType,
  extendType,
  intArg,
  arg,
  stringArg,
  queryField,
} from 'nexus'
import { getUSDTPrice } from '../../lib/convert-utils'
import math from '../../lib/math'
import { getMainWalletBalance } from '../../utils'
import { getConvertionSumary } from './convertion'
import { exchangeSumary } from './exchange'
import { getOrderByQuery } from '../../lib/utils'
import { Permission, Prisma } from '@prisma/client'
import { checkPermissions } from '../../lib/auth-utils'

export const walletGeneral = objectType({
  name: 'WalletGeneral',
  definition: (t) => {
    t.float('deposit')
    t.float('withdraw')
    t.float('pendingWithdraw')
    t.float('balance')
  },
})

export const userSumary = objectType({
  name: 'UserSumary',
  definition: (t) => {
    t.field('exchange', {
      type: 'ExchangeSumary',
    })
    t.field('convertion', {
      type: 'ConvertionSumaries',
    })
    t.field('general', {
      type: 'WalletGeneral',
    })
  },
})

export const userPagination = objectType({
  name: 'UserPagination',
  definition: (t) => {
    t.list.field('nodes', {
      type: 'User',
      nullable: true,
    })
    t.int('total')
  },
})

export const UserPorfolio = objectType({
  name: 'UserPorfolio',
  definition: (t) => {
    t.string('id')
    t.string('createdAt')
    t.string('username')
    t.string('email')
    t.string('name')
    t.field('role', { type: 'UserRole' })
    t.boolean('is_active')
    t.float('balance')
    t.string('exchange_wallet_id')
    t.int('total_bet')
    t.int('total_win')
    t.float('total_bet_amount')
    t.float('total_win_amount')
    t.float('total_send_amount')
    t.float('total_receive_amount')
    t.float('total_convert_in_amount')
    t.float('total_convert_out_amount')
    t.float('total_manual_in_amount')
    t.float('total_manual_out_amount')
    t.float('total_ref_commission_amount')
    t.float('total_copytrade_commission_amount')
    t.float('total_gift_code_in_amount')
  },
})

export const adminUserPorfolio = queryField('adminUserPorfolio', {
  type: 'UserPorfolio',
  args: {
    username: stringArg({ nullable: false }),
  },
  resolve: async (_, { username }, ctx) => {
    const userData = await ctx.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        *
      FROM
        "user" u
        LEFT JOIN (
          SELECT
            id,
            "type",
            base_balance,
            balance_cache_datetime,
            user_id,
            balance,
            exchange_wallet_id,
            total_send_amount,
            total_recieve_amount,
            total_convert_in_amount,
            total_convert_out_amount,
            total_manual_in_amount,
            total_manual_out_amount,
            total_ref_commission_amount,
            total_copytrade_commission_amount,
            total_gift_code_in_amount
          FROM
            exchange_wallet
            LEFT JOIN (
              SELECT
                exchange_wallet_id,
                SUM(amount) AS balance,
                SUM(CASE WHEN event_type = 'INTERNAL_TRANSACTION' AND amount > 0 THEN amount ELSE 0 END) AS total_recieve_amount,
                SUM(CASE WHEN event_type = 'INTERNAL_TRANSACTION' AND amount < 0 THEN amount * -1 ELSE 0 END) AS total_send_amount,
                SUM(CASE WHEN event_type = 'CONVERT' AND amount > 0 THEN amount ELSE 0 END) AS total_convert_in_amount,
                SUM(CASE WHEN event_type = 'CONVERT' AND amount < 0 THEN amount * -1 ELSE 0 END) AS total_convert_out_amount,
                SUM(CASE WHEN event_type = 'MANUAL' AND amount > 0 THEN amount ELSE 0 END) AS total_manual_in_amount,
                SUM(CASE WHEN event_type = 'MANUAL' AND amount < 0 THEN amount * -1 ELSE 0 END) AS total_manual_out_amount,
                SUM(CASE WHEN event_type = 'REF' THEN amount ELSE 0 END) AS total_ref_commission_amount,
                SUM(CASE WHEN event_type = 'COPY_TRADE_COMISSION' THEN amount ELSE 0 END) AS total_copytrade_commission_amount,
                SUM(CASE WHEN event_type = 'PROMOTION_CODE' THEN amount ELSE 0 END) AS total_gift_code_in_amount,
                SUM(CASE WHEN event_type = 'PROMOTION' THEN amount ELSE 0 END) AS total_promotion_amount
              FROM
                exchange_wallet_change
              GROUP BY
                exchange_wallet_id) bl ON bl.exchange_wallet_id = exchange_wallet.id
            WHERE
              "type" = 'MAIN') user_wallet ON user_wallet.user_id = u.id
        LEFT JOIN (
          SELECT
            "order".user_id,
            SUM(bet_amount) AS total_bet_amount,
            SUM(order_result.win_amount) AS total_win_amount,
            COUNT("order".id) AS total_bet,
            COUNT(CASE status WHEN 'WIN' then 1 else null end) AS total_win
          FROM
            "order"
            LEFT JOIN order_result ON order_result.order_id = "order".id
          GROUP BY
            "order".user_id) user_order ON user_order.user_id = u.id
      WHERE
        u.username = ${username}
    `)

    return userData[0]
  },
})

export const adminUsers = queryField('adminUsers', {
  type: 'UserPorfolio',
  list: true,
  args: {
    username: stringArg({ nullable: true }),
    skip: intArg({ nullable: true, default: 0 }),
    limit: intArg({ nullable: true, default: 10 }),
  },
  resolve: async (_, { username, limit, skip }, ctx) => {
    const usernameCondition = Prisma.sql`WHERE u.username LIKE ${`%${username}%`}`
    const userData = await ctx.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        *
      FROM
        "user" u
        LEFT JOIN (
          SELECT
            id,
            "type",
            base_balance,
            balance_cache_datetime,
            user_id,
            balance,
            exchange_wallet_id,
            total_send_amount,
            total_recieve_amount,
            total_convert_in_amount,
            total_convert_out_amount,
            total_manual_in_amount,
            total_manual_out_amount,
            total_ref_commission_amount,
            total_copytrade_commission_amount,
            total_gift_code_in_amount
          FROM
            exchange_wallet
            LEFT JOIN (
              SELECT
                exchange_wallet_id,
                SUM(amount) AS balance,
                SUM(CASE WHEN event_type = 'INTERNAL_TRANSACTION' AND amount > 0 THEN amount ELSE 0 END) AS total_recieve_amount,
                SUM(CASE WHEN event_type = 'INTERNAL_TRANSACTION' AND amount < 0 THEN amount * -1 ELSE 0 END) AS total_send_amount,
                SUM(CASE WHEN event_type = 'CONVERT' AND amount > 0 THEN amount ELSE 0 END) AS total_convert_in_amount,
                SUM(CASE WHEN event_type = 'CONVERT' AND amount < 0 THEN amount * -1 ELSE 0 END) AS total_convert_out_amount,
                SUM(CASE WHEN event_type = 'MANUAL' AND amount > 0 THEN amount ELSE 0 END) AS total_manual_in_amount,
                SUM(CASE WHEN event_type = 'MANUAL' AND amount < 0 THEN amount * -1 ELSE 0 END) AS total_manual_out_amount,
                SUM(CASE WHEN event_type = 'REF' THEN amount ELSE 0 END) AS total_ref_commission_amount,
                SUM(CASE WHEN event_type = 'COPY_TRADE_COMISSION' THEN amount ELSE 0 END) AS total_copytrade_commission_amount,
                SUM(CASE WHEN event_type = 'PROMOTION_CODE' THEN amount ELSE 0 END) AS total_gift_code_in_amount,
                SUM(CASE WHEN event_type = 'PROMOTION' THEN amount ELSE 0 END) AS total_promotion_amount
              FROM
                exchange_wallet_change
              GROUP BY
                exchange_wallet_id) bl ON bl.exchange_wallet_id = exchange_wallet.id
            WHERE
              "type" = 'MAIN') user_wallet ON user_wallet.user_id = u.id
        LEFT JOIN (
          SELECT
            "order".user_id,
            SUM(bet_amount) AS total_bet_amount,
            SUM(order_result.win_amount) AS total_win_amount,
            COUNT("order".id) AS total_bet,
            COUNT(CASE status WHEN 'WIN' then 1 else null end) AS total_win
          FROM
            "order"
            LEFT JOIN order_result ON order_result.order_id = "order".id
          GROUP BY
            "order".user_id) user_order ON user_order.user_id = u.id
      ${username ? usernameCondition : Prisma.empty}
      ORDER BY balance DESC
      LIMIT ${limit} OFFSET ${skip}
    `)

    return userData
  },
})

export const AdminUsersAggregate = objectType({
  name: 'AdminUsersAggregate',
  definition(t) {
    t.int('count')
  },
})

export const adminUsersAggregateQ = queryField('adminUsersAggregate', {
  type: 'AdminUsersAggregate',
  args: {
    username: stringArg({ nullable: true }),
  },
  resolve: async (_, { username }, ctx) => {
    const count = await ctx.prisma.user.count({
      where: {
        username: username ? { contains: username } : undefined,
      },
    })

    return {
      count,
    }
  },
})

export const adUserQuery = extendType({
  type: 'Query',
  definition: (t) => {
    t.field('userSumary', {
      type: 'UserSumary',
      args: {
        user_id: stringArg(),
      },
      resolve: async (_, { user_id }, ctx) => {
        await checkPermissions(ctx, ['CAN_VIEW_STATISTIC'])
        // cache usdt price with earch currency
        let currencies = await ctx.prisma.currency.findMany()
        if (!currencies || currencies.length === 0) {
          throw Error('Currency not found')
        }
        let usdtMap = new Map()
        for (let item of currencies) {
          let usdt = await getUSDTPrice(item.symbol, ctx.prisma)
          // console.log('usdt: ', usdt)
          usdtMap.set(item.id, usdt)
        }
        // await currencies.map(async (item) => {
        //   let usdt = await getUSDTPrice(item.symbol)
        //   console.log('usdt: ', usdt)
        //   usdtMap.set(item.id, usdt)
        // })
        let totalWithdraw = 0
        let pendingWithdraw = 0
        let totaldeposit = 0
        let totalBalance = 0

        let transactions = await ctx.prisma.mainWalletTransaction.findMany({
          where: {
            user_id,
            status: {
              not: 'FAILED',
            },
          },
          include: {
            Currency: true,
          },
        })
        // console.log('usdtMap: ', usdtMap)
        transactions &&
          transactions.map((item) => {
            const estimateUsd = math
              .mul(item.amount, usdtMap.get(item.currency_id))
              .toNumber()
            // console.log('estimateUsd: ', estimateUsd)
            if (item.tx_type === 'WITHDRAW') {
              if (item.status === 'PENDING') {
                pendingWithdraw = math
                  .add(estimateUsd, pendingWithdraw)
                  .toNumber()
              } else if (item.status === 'SUCCEED') {
                totalWithdraw = math.add(estimateUsd, totalWithdraw).toNumber()
              }
            } else if (item.tx_type === 'DEPOSIT') {
              totaldeposit = math.add(estimateUsd, totaldeposit).toNumber()
            }
          })
        // get balance
        let wallets = await ctx.prisma.mainWallet.findMany({
          where: {
            user_id,
          },
        })
        wallets.map(async (item) => {
          const walletBalance = await getMainWalletBalance(item, ctx.prisma)
          const estimateUsdBalance = math
            .mul(walletBalance, usdtMap.get(item.currency_id))
            .toNumber()
          totalBalance = math.add(estimateUsdBalance, totalBalance).toNumber()
        })
        // get exchange sumary
        let exchange = await exchangeSumary(ctx, user_id)
        let convertion = await getConvertionSumary(ctx, user_id)
        // console.log('convertion: ', convertion)
        // console.log('userSumary: ', {
        //   convertion,
        //   exchange,
        //   general: {
        //     balance: totalBalance,
        //     deposit: totaldeposit,
        //     withdraw: totalWithdraw,
        //     pendingWithdraw,
        //   },
        // })
        return {
          convertion,
          exchange,
          general: {
            balance: totalBalance,
            deposit: totaldeposit,
            withdraw: totalWithdraw,
            pendingWithdraw,
          },
        }
      },
    })

    // t.field('adminUsers', {
    //   type: 'UserPagination',
    //   args: {
    //     skip: intArg(),
    //     limit: intArg({ default: 10 }),
    //     status: arg({
    //       type: 'UserProfileStatus',
    //       nullable: true,
    //     }),
    //     roles: arg({
    //       type: 'UserRole',
    //       list: true,
    //     }),
    //     search: stringArg({ nullable: true }),
    //     orderBy: stringArg({ nullable: true }),
    //   },
    //   resolve: async (
    //     _,
    //     { skip, limit, status, search, orderBy, roles },
    //     ctx,
    //   ) => {
    //     // if (roles.includes('TRADER')) {
    //     //   await checkPermissions(ctx, ['CAN_VIEW_CUSTOMER'])
    //     // } else {
    //     //   await checkPermissions(ctx, ['CAN_VIEW_STAFF'])
    //     // }

    //     let where = {
    //       // role: {
    //       //   in: roles,
    //       // },
    //       UserProfile: {
    //         status: status,
    //       },
    //       OR: [
    //         {
    //           username: {
    //             contains: search,
    //           },
    //         },
    //         {
    //           email: {
    //             contains: search,
    //           },
    //         },
    //       ],
    //     }
    //     const { orderByField, order } = getOrderByQuery(
    //       orderBy,
    //       'createdAt desc',
    //     )

    //     const nodes = await ctx.prisma.user.findMany({
    //       where,
    //       skip,
    //       take: limit ?? 10,
    //       orderBy: {
    //         [orderByField]: order,
    //       },
    //     })

    //     const total = await ctx.prisma.user.count({
    //       where,
    //     })
    //     return {
    //       nodes,
    //       total,
    //     }
    //   },
    // })

    t.field('adminUser', {
      type: 'User',
      args: {
        user_id: stringArg(),
      },
      resolve: async (_, { user_id }, ctx) => {
        let user = await ctx.prisma.user.findUnique({
          where: {
            id: user_id,
          },
        })
        if (user.role === 'TRADER') {
          await checkPermissions(ctx, ['CAN_VIEW_CUSTOMER'])
        } else {
          await checkPermissions(ctx, ['CAN_VIEW_STAFF'])
        }
        return user
      },
    })

    t.field('permissions', {
      type: 'String',
      list: true,
      resolve: async (_) => {
        return Object.keys(Permission)

        // let permissions = Object.keys(Permission)
        // let result = permissions.filter((item) => {
        //   return isNaN(Number(item))
        // })

        // result = result.map((item) => Permission[item])
        // return result
      },
    })

    t.field('user', {
      type: 'User',
      args: {
        username: stringArg(),
      },
      resolve: async (_, { username }, ctx) => {
        return await ctx.prisma.user.findFirst({
          where: {
            username
          },
        })
      },
    })
  },
})

export const adUserMut = extendType({
  type: 'Mutation',
  definition: (t) => {
    t.field('updateUser', {
      type: 'User',
      args: {
        user_id: stringArg(),
        permissions: arg({
          type: 'Permission',
          list: true,
        }),
      },
      resolve: async (_, { user_id, permissions }, ctx) => {
        let user = await ctx.prisma.user.findUnique({
          where: {
            id: user_id,
          },
        })
        if (user.role === 'TRADER') {
          // update customer
          await checkPermissions(ctx, ['CAN_UPDATE_CUSTOMER'])
        } else {
          // update staff
          await checkPermissions(ctx, ['CAN_UPDATE_STAFF'])
        }
        user = await ctx.prisma.user.update({
          where: {
            id: user_id,
          },
          data: {
            permissions: {
              set: permissions,
            },
          },
        })
        return user
      },
    })
  },
})
