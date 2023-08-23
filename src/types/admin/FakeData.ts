import { extendType, intArg, stringArg } from 'nexus'
import { ValidationError } from '../../lib/error-util'
import { AccountType, BetType } from '@prisma/client'
import { getTimeID } from '../../lib/round-utils'
import { generateWalletAddress } from '../../lib/main-wallet-utils'
import { moralisStreamAddress } from '../../lib/moralis-v2-utils'
import { format } from 'date-fns'
import { nanoid } from 'nanoid'

export const fakeDatatMut = extendType({
  type: 'Mutation',
  definition: (t) => {
    t.field('fakeOrder', {
      type: 'Boolean',
      args: {
        timeFrame: stringArg({ required: true }),
        exchange_pair_id: stringArg({
          default: '49d5e47f-c1ee-416b-92aa-535cf5a4638d',
        }),
      },
      resolve: async (_, { timeFrame, exchange_pair_id }, ctx) => {
        if (ctx.role === 'TRADER') {
          throw new ValidationError({
            message: ctx.i18n.__("You haven't permission"),
          })
        }
        
        let total = getRndInteger(3, 7)
        let totalLose = Math.ceil(total * 0.3)
        console.log(
          '🚀 ~ file: FakeData.ts:42 ~ resolve: ~ totalLose:',
          total,
          totalLose,
        )
        let arr: boolean[] = []
        let amounts = [50, 100, 150, 200, 250, 300, 350, 400, 450]
        for (let i = 0; i < total; i++) {
          arr.push(i >= totalLose)
        }
        await Promise.all(
          arr.map(async (isWin: boolean) => {
            // let result = roundResults[getRndInteger(1, totalResult) - 1]
            let betTime = new Date(
              new Date(timeFrame).getTime() + getRndInteger(1, 50) * 60000,
            ).toISOString()
            let roundId = getTimeID(new Date(betTime).getTime())
            // let betTime = new Date(
            //   new Date(result.createdAt).getTime() - 12000,
            // ).toISOString()
            let betType = [BetType.DOWN, BetType.UP][getRndInteger(1, 2) - 1]
            let amount = amounts[getRndInteger(1, amounts.length) - 1]
            let order = await ctx.prisma.order.create({
              data: {
                user_id: ctx.user,
                bet_amount: amount,
                account_type: AccountType.MAIN,
                bet_type: betType,
                exchange_pair_id,
                bet_time: betTime,
                round_id: roundId,
                createdAt: betTime,
                updatedAt: betTime,
              },
            })
            let exchangeWallet = await ctx.prisma.exchangeWallet.findFirst({
              where: {
                user_id: ctx.user,
              },
            })
            await ctx.prisma.exchangeWalletChange.create({
              data: {
                createdAt: betTime,
                updatedAt: betTime,
                exchange_wallet_id: exchangeWallet.id,
                event_type: 'ORDER',
                event_id: order.id,
                amount: -order.bet_amount,
              },
            })
            let orderResult = await ctx.prisma.orderResult.create({
              data: {
                createdAt: betTime,
                updatedAt: betTime,
                round_id: roundId,
                is_win: isWin,
                win_amount: isWin ? amount * 0.95 : 0,
                order_id: order.id,
                user_id: ctx.user,
                status: isWin ? 'WIN' : 'LOSE',
              },
            })
            await ctx.prisma.exchangeWalletChange.create({
              data: {
                createdAt: betTime,
                updatedAt: betTime,
                exchange_wallet_id: exchangeWallet.id,
                event_type: 'ORDER_RESULT',
                event_id: orderResult.id,
                amount: orderResult.win_amount,
              },
            })

            await ctx.prisma.order.update({
              where: {
                id: order.id,
              },
              data: {
                order_result_id: orderResult.id,
              },
            })
          }),
        )
        return true
      },
    })
    t.field('fakeDeposit', {
      type: 'String',
      args: {
        dateDeposit: stringArg({ required: true }),
        amount: intArg({ required: true }),
        currencyId: stringArg({
          default: '4255e3a0-67b5-11ed-b0d7-37cc45ab4ca6',
        }),
      },
      resolve: async (_, { dateDeposit, currencyId, amount }, ctx) => {
        const wallet = await ctx.prisma.mainWallet.findFirst({
          where: {
            user_id: ctx.user,
            currency_id: currencyId,
          },
          include: {
            MainWalletAddress: true,
          },
        })

        if (!wallet) {
          console.log(`[Wallet.CreateWallet] Create wallet for ${ctx.user}`)
          // const { address } = await generateWalletAddressV2()
          const { address, encrypt_data } = await generateWalletAddress(
            currencyId,
            ctx.user,
          )

          if (address) {
            const currency = await ctx.prisma.currency.findUnique({
              where: {
                id: currencyId,
              },
            })
            await moralisStreamAddress(address, currency)
          }

          const wallet = await ctx.prisma.mainWallet.create({
            data: {
              Currency: {
                connect: {
                  id: currencyId,
                },
              },
              User: {
                connect: {
                  id: ctx.user,
                },
              },
              MainWalletAddress: {
                create: {
                  address,
                  encrypt_data,
                },
              },
              base_balance: 0,
              balance_cache_datetime: new Date(),
              is_frozen: false,
            },
          })
        }

        const mainWalletAddressByTransaction =
          await ctx.prisma.mainWalletAddress.findMany({
            where: {
              address: wallet.MainWalletAddress.address,
            },
            include: {
              MainWallet: true,
            },
          })

        const mainWallets = mainWalletAddressByTransaction.map(
          (address) => address.MainWallet,
        )

        const mainWallet = mainWallets.find(
          (wallet) => wallet.currency_id === currencyId,
        )

        if (!mainWallet) return 'Missing main wallet'

        const mainWalletAddress = mainWalletAddressByTransaction.find(
          (m) => m.main_wallet_id === mainWallet.id,
        )

        if (!mainWalletAddress) return 'Missing mainWalletAddress'
        try {
          let currency = await ctx.prisma.currency.findFirst({
            where: {
              id: currencyId,
            },
          })
          let time = new Date(new Date(dateDeposit).getTime()).toISOString()
          // await Promise.all(
          // amounts.map(async (amount) => {
          const usdt_tx = await ctx.prisma.mainWalletTransaction.create({
            data: {
              user_id: ctx.user,
              currency_id: currencyId,
              amount: Number(amount),
              tx_type: 'DEPOSIT',
              tx_hash: nanoid(),
              fee: 0,
              status: 'SUCCEED',
              address: wallet.MainWalletAddress.address,
              createdAt: new Date(
                new Date(time).getTime() + getRndInteger(100, 400) * 60000,
              ).toISOString(),
            },
            include: {
              User: true,
              Currency: true,
            },
          })

          console.log(
            await ctx.prisma.mainWalletChange.create({
              data: {
                main_wallet_id: wallet.id,
                event_type: 'TRANSACTION',
                event_id: usdt_tx.id,
                amount: usdt_tx.amount,
              },
            }),
          )
          // let time = new Date(dateDeposit).getTime() + getRndInteger(100, 500) * 60000

          await ctx.prisma.notification.create({
            data: {
              user_id: ctx.user,
              title: 'Deposit Successful',
              content: `You have recharged ${usdt_tx.amount} ${
                currency.symbol
              } at [${format(
                new Date(usdt_tx.createdAt),
                'HH:mm, dd/MM/yyyy',
              )}].
                  
          If this activity is not your own, please contact us immediately.`,
              description: '',
              type: 'DEPOSIT',
              createdAt: usdt_tx.createdAt,
            },
          })
          // }),
          // )

          await ctx.prisma.mainWalletAddress.update({
            where: {
              id: wallet.MainWalletAddress.id,
            },
            data: {
              need_sync_balance: true,
            },
          })
          return 'OK'
        } catch (error) {
          return error.message
        }
      },
    })
    t.field('fakeWithdraw', {
      type: 'String',
      args: {
        timeWithdraw: stringArg({ required: true }),
        amount: intArg({ required: true }),
        currencyId: stringArg({
          default: '4255e3a0-67b5-11ed-b0d7-37cc45ab4ca6',
        }),
      },
      resolve: async (_, { timeWithdraw, currencyId }, ctx) => {
        const wallet = await ctx.prisma.mainWallet.findFirst({
          where: {
            user_id: ctx.user,
            currency_id: currencyId,
          },
          include: {
            MainWalletAddress: true,
          },
        })
        let currency = await ctx.prisma.currency.findFirst({
          where: {
            id: currencyId,
          },
        })
        let total = getRndInteger(1, 3)
        let time =
          new Date(timeWithdraw).getTime() +
          getRndInteger(5, 10) * 3600000 +
          getRndInteger(10, 50) * 60000
        let transaction = await ctx.prisma.mainWalletTransaction.create({
          data: {
            user_id: ctx.user,
            currency_id: currencyId,
            address: wallet.MainWalletAddress.address,
            amount: getRndInteger(1, 4) * 1000,
            tx_type: 'WITHDRAW',
            fee: 100,
            confirmation: 0,
            status: 'SUCCEED',
            is_notified_admin: false,
            tx_hash: nanoid(),
            createdAt: new Date(time).toISOString(),
          },
          include: {
            User: true,
          },
        })

        await ctx.prisma.mainWalletChange.create({
          data: {
            main_wallet_id: wallet.id,
            amount: -transaction.amount,
            event_id: transaction.id,
            event_type: 'TRANSACTION',
          },
        })
        // console.log("🚀 ~ file: FakeData.ts:336 ~ [...Array ~ time:", new Date(time).toISOString())

        await ctx.prisma.notification.create({
          data: {
            user_id: ctx.user,
            title: 'Withdrawal Successful',
            content: `You have successfully withdrawn [${
              transaction.amount
            }] [${currency.symbol}] at [${format(
              new Date(transaction.createdAt),
              'HH:mm, dd/MM/yyyy',
            )}].\nIf this activity is not your own, please contact us immediately.`,
            description: '',
            type: 'WITHDRAW',
            createdAt: new Date(transaction.createdAt).toISOString(),
          },
        })
        return 'OK'
      },
    })
  },
})

function getRndInteger(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}
