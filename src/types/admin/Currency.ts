import { Prisma } from '.prisma/client'
import { objectType, queryField } from 'nexus'
import { findManyCursor } from '../../lib/findManyCursor'

export const AdminCurrency = objectType({
  name: 'AdminCurrency',
  definition(t) {
    t.string('id')
    t.string('name')
    t.string('symbol')
    t.boolean('is_enable')
    t.string('icon')
    t.string('disclaimer_deposit')
    t.string('disclaimer_withdraw')
    t.string('instruction_deposit')
    t.string('instruction_withdraw')
    t.string('regex')
    t.float('withdraw_manual_threshold')
    t.float('min_withdraw')
    t.float('max_withdraw')
    t.float('max_daily_withdraw')
    t.float('max_daily_withdraw_verified')
    t.float('withdraw_fee_flat')
    t.float('withdraw_fee_pct')
    t.boolean('is_enable_withdraw')
    t.boolean('is_enable_deposit')
    t.int('required_confirmation')
    t.boolean('is_enable_withdraw_cron')
    t.field('crypto_data', { type: 'Json' })
    t.float('admin_config_price')
    t.float('admin_config_price_volume_step')
    t.float('admin_config_total_volume')
    t.field('admin_config_volume_cache_time', { type: 'DateTime' })
    t.float('admin_config_price_price_step')
  },
})

export const CurrenciesConnection = queryField((t) => {
  t.connectionField('currencyConnection', {
    type: 'Currency',
    async resolve(root, args, ctx, info) {
      const actual = await findManyCursor(
        (argsi: Prisma.CurrencyFindManyArgs) => {
          console.log(argsi)
          return ctx.prisma.currency.findMany({
            ...argsi,
            where: {
              is_enable: true,
            },
          })
        },
        args,
      )

      return actual
    },
    totalCount(root, args, ctx, info) {
      return ctx.prisma.currency.count({
        where: {
          is_enable: true,
        },
      })
    },
  })
})
