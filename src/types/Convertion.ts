import { objectType, extendType, floatArg, intArg, arg, stringArg } from 'nexus'
import { getMainWalletBalance, getExchangeWalletBalance } from '../utils'
import { validateConvertion } from '../utils'
import * as math from '../lib/math'
import {
  getConvertPrice,
  exchangeWithBinance,
  updateTBRPriceData,
  getMaxConvertToTBRAmount,
  updatePlatformConvertionVolume,
} from '../lib/convert-utils'
import { verifyMainWallet } from '../lib/main-wallet-utils'
import { ValidationError } from '../lib/error-util'
import logger from '../lib/logger'
import config from '../config'

export const ConvertionTransaction = objectType({
  name: 'ConvertionTransaction',
  definition: (t) => {
    t.model.id
    t.model.createdAt()
    t.model.updatedAt()
    t.model.ExchangeWallet()
    t.model.MainWallet()
    t.model.price()
    t.model.amount()
    t.model.fee()
    t.model.converted_amount()
    t.model.user_id()
    t.model.direction()
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
        main_wallet: stringArg({ required: true }),
        exchange_wallet: stringArg({ required: true }),
        direction: arg({ type: 'ConvertionDirection', required: true }),
      },
      resolve: async (
        parent,
        { amount, direction, main_wallet, exchange_wallet },
        ctx,
      ) => {
        const lock = await ctx.redlock.lock(`lock:convert:${ctx.user}`, 3000)
        try {
          const userMainWallet = await ctx.prisma.mainWallet.findUnique({
            where: {
              id: main_wallet,
            },
            include: {
              Currency: true,
            },
          })

          // Verify currency config
          const currency = userMainWallet.Currency
          if (direction === 'MAIN_TO_EXCHANGE') {
            if (!currency.is_enable_convert_from) {
              throw new ValidationError({
                message: ctx.i18n.__(
                  'Convert from %@ is not enable'.replace(
                    '%@',
                    `${currency.name}`,
                  ),
                ),
              })
            }
          } else if (direction === 'EXCHANGE_TO_MAIN') {
            if (!currency.is_enable_convert_to) {
              throw new ValidationError({
                message: ctx.i18n.__(
                  'Convert to %@ is not enable'.replace(
                    '%@',
                    `${currency.name}`,
                  ),
                ),
              })
            }
          }

          // Verify Main Wallet
          const is_valid_main_wallet = await verifyMainWallet(userMainWallet)
          if (!is_valid_main_wallet) {
            throw new ValidationError({
              message: ctx.i18n.__('invalid_main_wallet'),
            })
          }

          const mainWalletBalace = await getMainWalletBalance(
            userMainWallet,
            ctx.prisma,
          )

          const userExchangeWallet = await ctx.prisma.exchangeWallet.findUnique(
            {
              where: {
                id: exchange_wallet,
              },
            },
          )
          const exchangeWalletBalance = await getExchangeWalletBalance(
            userExchangeWallet,
            ctx.prisma,
          )

          if (direction === 'MAIN_TO_EXCHANGE') {
            if (mainWalletBalace < amount) {
              throw new ValidationError({
                message: ctx.i18n.__('not_enough_balance'),
              })
            }
          } else if (direction === 'EXCHANGE_TO_MAIN') {
            if (exchangeWalletBalance < amount) {
              throw new ValidationError({
                message: ctx.i18n.__('not_enough_balance'),
              })
            }
          }

          const convertionPairs = await ctx.prisma.convertionPair.findMany({
            where: {
              currency_id: userMainWallet.currency_id,
            },
          })
          const convertionPair = convertionPairs[0]

          if (!convertionPair.is_enable) {
            throw new ValidationError({
              message: ctx.i18n.__(`Convertion pair not enable`),
            })
          }
          if (
            direction === 'MAIN_TO_EXCHANGE' &&
            convertionPair.max_convert_in &&
            convertionPair.total_convert_in + amount >=
              convertionPair.max_convert_in
          ) {
            throw new ValidationError({
              message: ctx.i18n.__(
                `Convert from ${currency.symbol} reached maximum`,
              ),
            })
          }
          if (
            direction === 'EXCHANGE_TO_MAIN' &&
            convertionPair.max_convert_out &&
            convertionPair.total_convert_out + amount >=
              convertionPair.max_convert_out
          ) {
            throw new ValidationError({
              message: ctx.i18n.__(
                `Convert to ${currency.symbol} reached maximum`,
              ),
            })
          }

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

          if (
            (convertionPair.name === 'TBR/USD' ||
              convertionPair.name === 'BDF/USD') &&
            direction === 'EXCHANGE_TO_MAIN'
          ) {
            const maxOut = await getMaxConvertToTBRAmount(
              ctx.user,
              convertionPair.id,
              ctx.prisma,
            )
            if (amount > maxOut) {
              throw new ValidationError({
                message: ctx.i18n.__(
                  'Amount over max out %@USD'.replace('%@', `${maxOut}`),
                ),
              })
            }
          }

          let price = await getConvertPrice(
            userMainWallet.Currency.symbol,
            direction,
            ctx.prisma,
          )

          const converted_amount = math.mul(amount, price).toNumber()
          const convcertionTransaction =
            await ctx.prisma.convertionTransaction.create({
              data: {
                amount,
                price,
                direction,
                converted_amount,
                MainWallet: {
                  connect: {
                    id: userMainWallet.id,
                  },
                },
                ExchangeWallet: {
                  connect: {
                    id: userExchangeWallet.id,
                  },
                },
                ConvertionPair: {
                  connect: {
                    id: convertionPair.id,
                  },
                },
                User: {
                  connect: {
                    id: ctx.user,
                  },
                },
              },
            })

          if (direction === 'MAIN_TO_EXCHANGE') {
            await ctx.prisma.mainWalletChange.create({
              data: {
                MainWallet: {
                  connect: {
                    id: userMainWallet.id,
                  },
                },
                event_id: convcertionTransaction.id,
                event_type: 'CONVERT',
                amount: -amount,
              },
            })
            await ctx.prisma.exchangeWalletChange.create({
              data: {
                ExchangeWallet: {
                  connect: {
                    id: userExchangeWallet.id,
                  },
                },
                amount: math.mul(amount, price).toNumber(),
                event_id: convcertionTransaction.id,
                event_type: 'CONVERT',
              },
            })
          } else if (direction === 'EXCHANGE_TO_MAIN') {
            await ctx.prisma.exchangeWalletChange.create({
              data: {
                ExchangeWallet: {
                  connect: {
                    id: userExchangeWallet.id,
                  },
                },
                amount: -amount,
                event_id: convcertionTransaction.id,
                event_type: 'CONVERT',
              },
            })
            await ctx.prisma.mainWalletChange.create({
              data: {
                MainWallet: {
                  connect: {
                    id: userMainWallet.id,
                  },
                },
                event_id: convcertionTransaction.id,
                event_type: 'CONVERT',
                amount: converted_amount,
              },
            })
          }

          // save total_convert_in/out to convertion pair
          await updatePlatformConvertionVolume(
            convertionPair.id,
            amount,
            direction,
            ctx.prisma,
          )

          // if (userMainWallet.Currency.symbol === 'TBR') {
          //   await updateTBRPriceData(amount, ctx.prisma)
          // }

          // Exchange with Binance
          // if (['ETH', 'BTC'].includes(userMainWallet.Currency.symbol)) {
          //   const binance_symbol = userMainWallet.Currency.symbol + 'USDT'
          //   const binance_side =
          //     direction === 'MAIN_TO_EXCHANGE' ? 'SELL' : 'BUY'
          //   const binance_amount =
          //     direction === 'MAIN_TO_EXCHANGE' ? amount : converted_amount
          //   exchangeWithBinance(
          //     binance_symbol.toUpperCase(),
          //     binance_side,
          //     binance_amount,
          //   )
          // }

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
        currencySymbol: stringArg(),
        direction: arg({ type: 'ConvertionDirection' }),
      },
      resolve: async (_, args, ctx) => {
        // Admin config price
        if (config.priceConfigableCurrencies.has(args.currencySymbol)) {
          const currency = await ctx.prisma.currency.findFirst({
            where: {
              symbol: args.currencySymbol,
            },
          })
          if (currency && currency.admin_config_price) {
            const price =
              args.direction === 'MAIN_TO_EXCHANGE'
                ? currency.admin_config_price
                : 1 / currency.admin_config_price
            return price
          } else {
            logger.error(
              `Currency ${args.currencySymbol} price is not configured!`,
            )
          }
        }

        // get price from 3rd party service
        const res = await getConvertPrice(
          args.currencySymbol,
          args.direction,
          ctx.prisma,
        )
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
