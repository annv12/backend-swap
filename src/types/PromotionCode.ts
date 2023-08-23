import {
  objectType,
  extendType,
  floatArg,
  stringArg,
  intArg,
} from 'nexus'
import { customAlphabet } from 'nanoid'
import logger from '../lib/logger'
import { ValidationError } from '../lib/error-util'
import { getSpendableBalance } from '../lib/wallet-utils'
import math from '../lib/math'
import { getExchangeWalletBalance } from '../utils'
import { Prisma } from '@prisma/client'
import { checkTokenTwoFaEnabled } from '../lib/auth-utils'

const nanoid = customAlphabet('1234567890QWERTYUIOPASDFGHJKLZXCVBNM', 12)

export const PromotionCode = objectType({
  name: 'PromotionCode',
  definition: (t) => {
    t.model.id()
    t.model.createdAt()
    t.model.code()
    t.model.amount()
    t.model.expiration_date()
    t.model.allowed_transaction()
    t.model.PromotionCodeTransaction()
  },
})

export const PromotionCodeTransaction = objectType({
  name: 'PromotionCodeTransaction',
  definition: (t) => {
    t.model.id()
    t.model.createdAt()
    t.model.type()
    t.model.promotion_code_id()
    t.model.user_id()
    t.model.User()
  },
})

export const BuyPromotionCodeTransaction = objectType({
  name: 'BuyPromotionCodeTransaction',
  definition: (t) => {
    t.model.id()
    t.model.createdAt()
    t.model.quantity()
    t.model.amount_per_code()
    t.model.user_id()
    t.model.User()
    t.model.PromotionCode()
  },
})

export const PromotionCodeMutation = extendType({
  type: 'Mutation',
  definition: (t) => {
    t.field('createPromotionCode', {
      type: 'PromotionCode',
      list: true,
      args: {
        amount: floatArg({ required: true }),
        code: stringArg({ required: false }),
        numberOfCode: intArg({ required: true }),
        expirationDate: stringArg({ required: false }),
        allowedTransaction: intArg({ required: false }),
      },
      resolve: async (
        _,
        { numberOfCode, code, amount, expirationDate, allowedTransaction },
        ctx,
      ) => {
        let tomorrow = new Date()
        tomorrow.setDate(new Date().getDate() + 1)

        if (code) {
          const gCode = nanoid()
          const createPromocode = await ctx.prisma.promotionCode.create({
            data: {
              amount,
              code: code,
              expiration_date: expirationDate || tomorrow,
              allowed_transaction: allowedTransaction,
            },
          })
          return [createPromocode]
        } else {
          const pr = []
          for (let i = 0; i < numberOfCode; i++) {
            const gCode = nanoid()
            const createPromocode = ctx.prisma.promotionCode.create({
              data: {
                amount,
                code: gCode,
                expiration_date: expirationDate || tomorrow,
                allowed_transaction: allowedTransaction,
              },
            })
            pr.push(createPromocode)
          }

          const result = await Promise.all(pr)

          return result
        }
      },
    })

    t.field('addPromotionCode', {
      type: 'Boolean',
      args: {
        code: stringArg({ required: true }),
      },
      resolve: async (_, { code }, ctx) => {
        // if (!addPromotionCodelocks.has(`add_promo_code_${ctx.user}`)) {
        //   addPromotionCodelocks.set(`add_promo_code_${ctx.user}`, new Mutex())
        // }
        // const release = await addPromotionCodelocks
        //   .get(`add_promo_code_${ctx.user}`)
        //   .acquire()
        const lock = await ctx.redlock.lock(
          `lock:add_promo_code:${ctx.user}`,
          3000,
        )

        try {
          const promotionCode = await ctx.prisma.promotionCode.findUnique({
            where: {
              code,
            },
          })
          if (!promotionCode) {
            throw new ValidationError({
              message: ctx.i18n.__('Promotion code not found'),
            })
          }

          logger.info(
            `[PromotionCode] user ${ctx.user} add promotion code ${code}, amount: ${promotionCode.amount}`,
          )

          if (promotionCode.expiration_date < new Date()) {
            throw new ValidationError({
              message: ctx.i18n.__('Promotion code expired'),
            })
          }

          const promotionCodeUsedTime = await ctx.prisma.promotionCodeTransaction.count(
            {
              where: {
                promotion_code_id: promotionCode.id,
              },
            },
          )
          if (promotionCode.allowed_transaction <= promotionCodeUsedTime) {
            throw new ValidationError({
              message: ctx.i18n.__('Promotion code is maximum used'),
            })
          }

          const userWallets = await ctx.prisma.exchangeWallet.findMany({
            where: {
              user_id: ctx.user,
            },
          })
          const userPromotionWallet = userWallets.find(
            (i) => i.type === 'PROMOTION',
          )
          logger.info(
            `[PromotionCode] user promotion wallet: `,
            userPromotionWallet,
          )

          const promoCodeTx = await ctx.prisma.promotionCodeTransaction.create({
            data: {
              type: 'APPLY',
              User: {
                connect: {
                  id: ctx.user,
                },
              },
              PromotionCode: {
                connect: {
                  id: promotionCode.id,
                },
              },
            },
          })

          await ctx.prisma.exchangeWalletChange.create({
            data: {
              amount: promotionCode.amount,
              event_id: promoCodeTx.id,
              event_type: 'PROMOTION_CODE',
              ExchangeWallet: {
                connect: {
                  id: userPromotionWallet.id,
                },
              },
            },
          })

          logger.info(
            `[PromotionCode] added for user ${ctx.user}, amount: ${promotionCode.amount}`,
          )

          return true
        } catch (error) {
          logger.error(
            `[PromotionCode] add promotion code for ${ctx.user} error`,
            error,
          )
          return error
        } finally {
          // release()
          lock.unlock().catch(function (err: any) {
            console.error('lock err: ', err)
          })
        }
      },
    })

    t.field('buyPromotionCode', {
      type: 'BuyPromotionCodeTransaction',
      // type: 'Boolean',
      args: {
        quantity: intArg({ required: true }),
        amountPerCode: floatArg({ required: true }),
        expireDate: stringArg({ required: true }),
        otpToken: stringArg({ required: true }),
      },
      resolve: async (_, { quantity, amountPerCode, expireDate, otpToken }, ctx) => {
        const userProfile = await ctx.prisma.userProfile.findUnique({
          where: {
            user_id: ctx.user,
          },
        })

        if (!userProfile.is_agency) {
          throw new ValidationError({
            message: ctx.i18n.__(`Only agency can buy giftcode`),
          })
        }

        // check 2fa is enable and verify 2fa, bypass if admin config
        if (!userProfile.admin_config_bypass_2fa) {
          await checkTokenTwoFaEnabled(otpToken, ctx.user, ctx.prisma, ctx.i18n)
        }

        const oneDayAfter = Date.now() + 60 * 60 * 6 * 1000
        const expireInput = new Date(expireDate).getTime()
        if (expireInput < oneDayAfter) {
          throw new ValidationError({
            message: ctx.i18n.__(`Expire date should be greater than 6 hours`),
          })
        }

        const userExchangeWallet = await ctx.prisma.exchangeWallet.findFirst({
          where: {
            user_id: ctx.user,
            type: 'MAIN',
          },
        })

        const lock = await ctx.redlock.lock(`lock:bet:${ctx.user}`, 3000)

        try {
          // const userbalance = await getSpendableBalance(ctx.user, ctx.prisma)
          const userbalance = await getExchangeWalletBalance(
            userExchangeWallet,
            ctx.prisma,
          )

          const totalSpendAmount = math.mul(quantity, amountPerCode).toNumber()

          if (userbalance < totalSpendAmount) {
            throw new ValidationError({
              message: ctx.i18n.__(`balance not enought`),
            })
          }

          const buyPromotionCodeTx = await ctx.prisma.buyPromotionCodeTransaction.create(
            {
              data: {
                quantity,
                amount_per_code: amountPerCode,
                User: {
                  connect: {
                    id: ctx.user,
                  },
                },
              },
            },
          )

          const walletChange = await ctx.prisma.exchangeWalletChange.create({
            data: {
              amount: -totalSpendAmount,
              event_id: buyPromotionCodeTx.id,
              event_type: 'BUY_PROMOTION_CODE',
              ExchangeWallet: {
                connect: {
                  id: userExchangeWallet.id,
                },
              },
            },
          })

          for (let i = 1; i <= quantity; i++) {
            const gCode = nanoid()
            const promotionCode = await ctx.prisma.promotionCode.create({
              data: {
                amount: amountPerCode,
                code: gCode,
                // 24h
                expiration_date: new Date(expireDate),
                BuyPromotionCodeTransaction: {
                  connect: {
                    id: buyPromotionCodeTx.id,
                  },
                },
              },
            })
          }

          return buyPromotionCodeTx
        } catch (err) {
          return err
        } finally {
          lock.unlock().catch(function (err) {
            console.error('unlock err: ', err)
          })
        }
      },
    })
  },
})

export const BuyPromotionCodeHistoryAggregate = objectType({
  name: 'BuyPromotionCodeHistoryAggregate',
  definition: (t) => {
    t.int('count')
  },
})

export const GiftCodePurchaseHistory = objectType({
  name: 'GiftCodePurchaseHistory',
  definition: (t) => {
    t.string('id')
    t.string('createdAt')
    t.string('code')
    t.float('amount')
    t.string('expirationDate')
    t.field('status', { type: 'PromotionCodeTransactionType' })
    t.string('transactionAt')
    t.string('username')
    // t.field('PromotionCodeTransaction', { type: 'PromotionCodeTransaction' })
  },
})

export const PromotionCodeQuery = extendType({
  type: 'Query',
  definition: (t) => {
    t.list.field('buyPromotionCodeHistory', {
      type: 'BuyPromotionCodeTransaction',
      args: {
        skip: intArg(),
        limit: intArg({ default: 10 }),
      },
      resolve: async (_, { skip, limit }, ctx) => {
        console.log("ctx.user", ctx.user)
        const result = await ctx.prisma.buyPromotionCodeTransaction.findMany({
          where: {
            user_id: ctx.user,
          },
          take: limit,
          skip,
          orderBy: {
            createdAt: 'desc',
          },
        })

        return result
      },
    })

    t.field('buyPromotionCodeHistoryAggregation', {
      type: 'BuyPromotionCodeHistoryAggregate',
      args: {},
      resolve: async (_, args, ctx) => {
        const res = await ctx.prisma.buyPromotionCodeTransaction.count({
          where: {
            user_id: ctx.user,
          },
          orderBy: {
            createdAt: 'desc',
          },
        })

        return { count: res }
      },
    })

    t.list.field('giftCodePurchareHistory', {
      type: 'GiftCodePurchaseHistory',
      args: {
        skip: intArg({ default: 0 }),
        limit: intArg({ default: 10 }),
        search: stringArg({
          default: '',
          description: 'Search by CODE or USERNAME',
        }),
      },
      resolve: async (_, { skip, limit, search }, ctx) => {
        const res = await ctx.prisma.$queryRaw<any>(
          Prisma.sql`
          SELECT
            pc.id,
            pc.created_at,
            pc.code,
            pc.amount,
            pc.expiration_date,
            pctx.type,
            pctx.created_at AS transaction_at,
            "user".username
          FROM
            promotion_code pc
            LEFT JOIN promotion_code_transaction pctx ON pctx.promotion_code_id = pc.id
            LEFT JOIN "user" ON "user".id = pctx.user_id
            LEFT JOIN buy_promotion_code_transaction bprt ON bprt.id = pc.buy_promotion_code_transaction_id
          WHERE (lower(pc.code) LIKE ${`%${search.toLowerCase()}%`}
            OR lower("user".username) LIKE ${`%${search.toLowerCase()}%`})
          AND buy_promotion_code_transaction_id IS NOT NULL
          AND bprt.user_id = ${ctx.user}
          ORDER BY pc.created_at DESC
          LIMIT ${limit} OFFSET ${skip}
        `,
        )

        const result = res.map((i: any) => {
          return {
            id: i.id,
            createdAt: i.created_at,
            code: i.code,
            amount: i.amount,
            expirationDate: i.expiration_date,
            status: i.type,
            transactionAt: i.transaction_at,
            username: i.username,
          }
        })
        return result
      },
    })

    t.field('giftCodePurchareHistoryAggregate', {
      type: 'BuyPromotionCodeHistoryAggregate',
      args: {
        search: stringArg({
          default: '',
          description: 'Search by CODE or USERNAME',
        }),
      },
      resolve: async (_, { search }, ctx) => {
        const res = await ctx.prisma.$queryRaw<any>(
          Prisma.sql`
          SELECT
            COUNT(pc.id)
          FROM
            promotion_code pc
            LEFT JOIN promotion_code_transaction pctx ON pctx.promotion_code_id = pc.id
            LEFT JOIN "user" ON "user".id = pctx.user_id
            LEFT JOIN buy_promotion_code_transaction bprt ON bprt.id = pc.buy_promotion_code_transaction_id
          WHERE (pc.code ILIKE $1
            OR "user".username ILIKE $1)
          AND buy_promotion_code_transaction_id IS NOT NULL
          AND bprt.user_id = ${ctx.user}
        `,
          `%${search.toLowerCase()}`,
        )

        return { count: res[0].count }
      },
    })
  },
})
