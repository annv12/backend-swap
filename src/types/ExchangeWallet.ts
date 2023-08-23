import { arg, mutationField, stringArg } from 'nexus'

export const CreateWalletMutation = mutationField('createExchangeWallet', {
  type: 'ExchangeWallet',
  args: {
    type: arg({
      required: true,
      default: 'MAIN',
      type: 'AccountType',
    }),
  },
  resolve: async (_, { type }, ctx) => {
    const wallet = await ctx.prisma.exchangeWallet.create({
      data: {
        type,
        base_balance: 0,
        balance_cache_datetime: new Date(),
        user_id: ctx.user,
      },
    })

    return wallet
  },
})
