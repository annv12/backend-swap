import { objectType, queryType, extendType } from 'nexus'
import { getDailyStats, getUSDTPrice } from '../lib/convert-utils'

export const Post = objectType({
  name: 'Currency',
  definition(t) {
    t.model.id()
    t.model.name()
    t.model.symbol()
    t.model.is_enable()
    t.model.icon()
    t.model.disclaimer_deposit()
    t.model.disclaimer_withdraw()
    t.model.instruction_deposit()
    t.model.instruction_withdraw()
    t.model.regex()
    t.model.withdraw_manual_threshold()
    t.model.min_withdraw()
    t.model.max_withdraw()
    t.model.max_daily_withdraw()
    t.model.max_daily_withdraw_verified()
    t.model.withdraw_fee_flat()
    t.model.withdraw_fee_pct()
    t.model.is_enable_withdraw()
    t.model.is_enable_deposit()
    t.model.required_confirmation()
    t.model.is_enable_withdraw_cron()
    t.model.crypto_data()
    // t.model.Wallet({ pagination: true })
    // t.model.Transaction({ pagination: true })
  },
})
export const CoinPayload = objectType({
  name: 'CoinPayload',
  definition(t) {
    t.string('name')
    t.string('symbol')
    t.float('price')
    t.float('priceChange')
    t.float('volume')
  },
})

export const allAvailableCurrency = extendType({
  type: 'Query',
  definition: (t) => {
    t.list.field('allAvailableCurrency', {
      type: 'Currency',
      resolve: async (_, args, ctx) => {
        const res = await ctx.prisma.currency.findMany({
          where: {
            is_enable: true,
          },
        })
        return res
      },
    })

    t.list.field('coinList', {
      type: 'CoinPayload',
      resolve: async (_, args, ctx) => {
        const currencies = await ctx.prisma.currency.findMany({
          where: {
            is_enable: true,
          },
        })
        return await Promise.all(
          currencies.map(async (currency) => {
            let [price, stats] = await Promise.all([
              getUSDTPrice(currency),
              getDailyStats(`${currency.symbol}USDT`),
            ])
            return {
              name: currency.name,
              symbol: currency.symbol,
              price,
              priceChange: stats.priceChange,
              volume: stats.volume,
            }
          }),
        )
      },
    })
  },
})
