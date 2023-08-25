import { mutationType, stringArg } from 'nexus'
import { ValidationError } from '../lib/error-util'
import { getUserId } from '../utils'

export const Mutation = mutationType({
  definition(t) {
    t.crud.updateOneCurrency({
      alias: 'adminUpdateOneCurrency',
      type: 'AdminCurrency',
    })

    t.field('createCurrency', {
      type: 'Currency',
      args: {
        name: stringArg({ nullable: false }),
        symbol: stringArg({ nullable: false }),
        icon: stringArg(),
      },
      resolve: async (parent, { name, symbol, icon }, ctx) => {
        const userId = getUserId(ctx)
        if (!userId)
          throw new ValidationError({
            message: ctx.i18n.__('Not authenticated'),
          })
        return await ctx.prisma.currency.create({
          data: {
            name,
            symbol,
            icon,
            is_enable: true,
            withdraw_manual_threshold: 0,
            min_withdraw: 0,
            max_withdraw: 100,
            max_daily_withdraw: 100,
            max_daily_withdraw_verified: 100,
            withdraw_fee_flat: 0,
            withdraw_fee_pct: 0,
          },
        })
      },
    })
  },
})
