import { objectType, queryType, extendType } from 'nexus'

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
  },
})
