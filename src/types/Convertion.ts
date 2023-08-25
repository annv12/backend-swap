import { objectType, extendType, floatArg, intArg, arg, stringArg } from 'nexus'
import { getMainWalletBalance } from '../utils'
import { validateConvertion } from '../utils'
import * as math from '../lib/math'
import { getConvertPrice } from '../lib/convert-utils'
import { verifyMainWallet } from '../lib/main-wallet-utils'
import { ValidationError } from '../lib/error-util'
import { ConvertionDirection } from '@prisma/client'

export const ConvertionTransaction = objectType({
  name: 'ConvertionTransaction',
  definition: (t) => {
    t.model.id
    t.model.createdAt()
    t.model.updatedAt()
    t.model.MainWalletFrom()
    t.model.MainWalletTo()
    t.model.price()
    t.model.amount()
    t.model.fee()
    t.model.converted_amount()
    t.model.user_id()
  },
})

export const ConvertionAggregate = objectType({
  name: 'ConvertionAggregate',
  definition: (t) => {
    t.int('count')
  },
})

export const ConvertCurrencyPayload = objectType({
  name: 'ConvertCurrencyPayload',
  definition(t) {
    t.boolean('success')
  },
})

export const convertCurrency = extendType({
  type: 'Mutation',
  definition: (t) => {
    t.field('convertCurrency', {
      type: 'ConvertCurrencyPayload',
      args: {
        amount: floatArg({ required: true }),
        currency_from: stringArg({ required: true }),
        currency_to: stringArg({ required: true }),
      },
      resolve: async (parent, { amount, currency_from, currency_to }, ctx) => {
        const lock = await ctx.redlock.lock(`lock:convert:${ctx.user}`, 3000)
        try {
          const [userMainWalletFrom, userMainWalletTo] = await Promise.all([
            ctx.prisma.mainWallet.findFirst({
              where: {
                currency_id: currency_from,
                user_id: ctx.user,
              },
              include: {
                Currency: true,
              },
            }),
            ctx.prisma.mainWallet.findFirst({
              where: {
                currency_id: currency_to,
                user_id: ctx.user,
              },
              include: {
                Currency: true,
              },
            }),
          ])

          // Verify currency config
          const currencyFrom = userMainWalletFrom.Currency
          const currencyTo = userMainWalletTo.Currency
          // if (direction === 'MAIN_TO_EXCHANGE') {
          if (!currencyFrom.is_enable_convert_from) {
            throw new ValidationError({
              message: ctx.i18n.__(
                'Convert from %@ is not enable'.replace(
                  '%@',
                  `${currencyFrom.name}`,
                ),
              ),
            })
          }
          // }
          // else if (direction === 'EXCHANGE_TO_MAIN') {
          if (!currencyTo.is_enable_convert_to) {
            throw new ValidationError({
              message: ctx.i18n.__(
                'Convert to %@ is not enable'.replace(
                  '%@',
                  `${currencyTo.name}`,
                ),
              ),
            })
          }
          // }

          // Verify Main Wallet
          const [is_valid_main_wallet_from, is_valid_main_wallet_to] =
            await Promise.all([
              verifyMainWallet(userMainWalletFrom),
              verifyMainWallet(userMainWalletTo),
            ])
          if (!is_valid_main_wallet_from || !is_valid_main_wallet_to) {
            throw new ValidationError({
              message: ctx.i18n.__('invalid_main_wallet'),
            })
          }

          const mainWalletBalaceFrom = await getMainWalletBalance(
            userMainWalletFrom,
            ctx.prisma,
          )

          // if (direction === 'MAIN_TO_EXCHANGE') {
          if (mainWalletBalaceFrom < amount) {
            throw new ValidationError({
              message: ctx.i18n.__('not_enough_balance'),
            })
          }
          // } else if (direction === 'EXCHANGE_TO_MAIN') {
          //   if (exchangeWalletBalance < amount) {
          //     throw new ValidationError({
          //       message: ctx.i18n.__('not_enough_balance'),
          //     })
          //   }
          // }

          const convertionPair = await ctx.prisma.convertionPair.findFirst({
            where: {
              OR: [
                {
                  currency_from,
                  currency_to,
                },
                {
                  currency_from: currency_to,
                  currency_to: currency_from,
                },
              ],
            },
            include: {
              CurrencyFrom: true,
              CurrencyTo: true,
            },
          })

          if (!convertionPair) {
            throw new ValidationError({
              message: ctx.i18n.__(`Convertion pair not found`),
            })
          }

          if (!convertionPair.is_enable) {
            throw new ValidationError({
              message: ctx.i18n.__(`Convertion pair not enable`),
            })
          }
          let direction: ConvertionDirection =
            userMainWalletFrom.currency_id == convertionPair.currency_from
              ? ConvertionDirection.MAIN_TO_EXCHANGE
              : ConvertionDirection.EXCHANGE_TO_MAIN
          const isConvertionAmountValid = await validateConvertion(
            amount,
            convertionPair,
            direction,
            ctx.i18n,
            ctx.prisma,
          )
          if (isConvertionAmountValid.error) {
            throw new ValidationError({
              message: isConvertionAmountValid.message,
            })
          }

          let price = await getConvertPrice(
            userMainWalletFrom.Currency.symbol,
            userMainWalletTo.Currency.symbol,
            // direction,
            ctx.prisma,
          )

          const converted_amount = math.mul(amount, price).toNumber()
          const convertionTransaction =
            await ctx.prisma.convertionTransaction.create({
              data: {
                amount,
                price,
                direction: ConvertionDirection.MAIN_TO_MAIN,
                converted_amount,
                main_wallet_id_from: userMainWalletFrom.id,
                main_wallet_id_to: userMainWalletTo.id,
                convertion_pair_id: convertionPair.id,
                user_id: ctx.user,
              },
            })
          await Promise.all([
            ctx.prisma.mainWalletChange.create({
              data: {
                main_wallet_id: userMainWalletFrom.id,
                event_id: convertionTransaction.id,
                event_type: 'CONVERT',
                amount: -amount,
              },
            }),
            ctx.prisma.mainWalletChange.create({
              data: {
                main_wallet_id: userMainWalletTo.id,
                event_id: convertionTransaction.id,
                event_type: 'CONVERT',
                amount: converted_amount,
              },
            }),
          ])

          return { success: true }
        } catch (error) {
          return error
        } finally {
          // release()
          lock.unlock().catch(function (err: any) {
            console.error('lock err: ', err)
          })
        }
      },
    })
  },
})

export const convertions = extendType({
  type: 'Query',
  definition: (t) => {
    t.list.field('userConvertions', {
      type: 'ConvertionTransaction',
      args: {
        skip: intArg(),
        limit: intArg({ default: 10 }),
      },
      resolve: (_, { skip, limit }, ctx) => {
        return ctx.prisma.convertionTransaction.findMany({
          where: {
            user_id: ctx.user,
          },
          skip,
          take: limit,
          orderBy: {
            createdAt: 'desc',
          },
        })
      },
    })

    t.field('getConvetionPrice', {
      type: 'Float',
      args: {
        currencySymbolFrom: stringArg({ required: true }),
        currencySymbolTo: stringArg({ required: true }),
      },
      resolve: async (_, { currencySymbolFrom, currencySymbolTo }, ctx) => {
        console.log(
          '🚀 ~ file: Convertion.ts:276 ~ resolve: ~ currencySymbolFrom, currencySymbolTo:',
          currencySymbolFrom,
          currencySymbolTo,
        )
        const res = await getConvertPrice(
          currencySymbolFrom,
          currencySymbolTo,
          ctx.prisma,
        )
        console.log('🚀 ~ file: Convertion.ts:281 ~ resolve: ~ res:', res)
        return res
      },
    })

    t.field('convertionAggregate', {
      type: 'ConvertionAggregate',
      resolve: async (_, args, ctx) => {
        const count = await ctx.prisma.convertionTransaction.count({
          where: {
            user_id: ctx.user,
          },
        })

        return { count }
      },
    })
  },
})
