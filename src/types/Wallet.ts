import { objectType, extendType, intArg, stringArg, floatArg } from 'nexus'
import { getMainWalletBalance } from '../utils'
import {
  generateWalletAddress,
  verifyMainWallet,
  calculateFee,
} from '../lib/main-wallet-utils'
import { customAlphabet } from 'nanoid'
import logger from '../lib/logger'
import { checkTokenTwoFaEnabled } from '../lib/auth-utils'
import { notifyThresholdWithdrawTransaction } from '../lib/notify-utils'
import { ValidationError } from '../lib/error-util'
import { moralisStreamAddress } from '../lib/moralis-v2-utils'

const nanoid = customAlphabet('1234567890QWERTYUIOPASDFGHJKLZXCVBNM', 16)

export const MainWallet = objectType({
  name: 'MainWallet',
  definition: (t) => {
    t.model.id()
    t.model.createdAt()
    t.model.updatedAt()
    t.model.base_balance()
    t.model.balance_cache_datetime()
    t.model.is_frozen()
    t.model.currency_id()
    t.model.user_id()
    t.model.User()
    t.model.Currency()
    t.model.MainWalletAddress()
    t.float('balance', { nullable: true })
  },
})

export const MainWalletAddress = objectType({
  name: 'MainWalletAddress',
  definition: (t) => {
    t.model.id()
    t.model.address()
    t.model.encrypt_data()
    t.model.balance()
  },
})

export const createWalletRequest = extendType({
  type: 'Mutation',
  definition: (t) => {
    t.field('createWalletRequest', {
      type: 'MainWallet',
      args: {
        currency_id: stringArg({ nullable: false }),
      },
      resolve: async (parent, args, ctx) => {
        const isUserAlreadyHasWallet = await ctx.prisma.mainWallet.findMany({
          where: {
            user_id: ctx.user,
            currency_id: args.currency_id,
          },
        })

        logger.info(`[Wallet.CreateWallet] isUserAlreadyHasWallet, `, {
          isUserAlreadyHasWallet,
        })

        if (isUserAlreadyHasWallet.length < 1) {
          console.log(`[Wallet.CreateWallet] Create wallet for ${ctx.user}`)
          // const { address } = await generateWalletAddressV2()
          const { address, encrypt_data } = await generateWalletAddress(
            args.currency_id,
            ctx.user,
          )

          if (address) {
            const currency = await ctx.prisma.currency.findUnique({
              where: {
                id: args.currency_id,
              },
            })
            await moralisStreamAddress(address, currency)
          }

          const wallet = await ctx.prisma.mainWallet.create({
            data: {
              Currency: {
                connect: {
                  id: args.currency_id,
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
          return { ...wallet, balance: 0 }
        } else {
          const w = isUserAlreadyHasWallet[0]
          const balance = await getMainWalletBalance(w, ctx.prisma)
          return { ...w, balance }
        }
      },
    })
  },
})

export const WithdrawPayload = objectType({
  name: 'WithdrawPayload',
  definition(t) {
    t.boolean('success')
  },
})

export const withdraw = extendType({
  type: 'Mutation',
  definition: (t) => {
    t.field('withdraw', {
      type: 'WithdrawPayload',
      args: {
        address: stringArg({ required: true }),
        amount: floatArg({ required: true }),
        memo: stringArg({ required: false }),
        currency_id: stringArg({ required: true }),
        otpToken: stringArg({ required: true }),
      },
      resolve: async (
        parent,
        { address, amount, currency_id, otpToken },
        ctx,
      ) => {
        const lock = await ctx.redlock.lock(`lock:withdraw:${ctx.user}`, 3000)

        try {
          await checkTokenTwoFaEnabled(otpToken, ctx.user, ctx.prisma, ctx.i18n)
          // check currency enable, enable withdraw, invalid address, check balance, calculate fee, check min + max
          // first get currency info
          let currency = await ctx.prisma.currency.findUnique({
            where: {
              id: currency_id,
            },
          })
          // check currency enabled
          if (!currency || !currency.is_enable) {
            throw new ValidationError({
              message: ctx.i18n.__('Currency not enable'),
            })
          }
          // check enable_withdraw
          if (!currency.is_enable_withdraw) {
            throw new ValidationError({
              message: ctx.i18n.__('Withdraw not enable'),
            })
          }

          // get fee
          if (
            currency.withdraw_fee_pct === null ||
            currency.withdraw_fee_flat === null
          ) {
            throw new ValidationError({
              message: ctx.i18n.__('Withdraw fee not configed'),
            })
          }

          const user = await ctx.prisma.user.findUnique({
            where: {
              id: ctx.user,
            },
            include: {
              UserProfile: true,
            },
          })

          const fee = calculateFee(
            amount,
            currency.withdraw_fee_flat,
            currency.withdraw_fee_pct,
            user.UserProfile.admin_config_withdraw_fee,
          )

          const mainWallet = await ctx.prisma.mainWallet.findFirst({
            where: {
              user_id: ctx.user,
              currency_id: currency_id,
            },
            include: {
              MainWalletAddress: true,
            },
          })
          if (!mainWallet) {
            throw new ValidationError({
              message: ctx.i18n.__('Wallet not found'),
            })
          }

          if (mainWallet.is_frozen) {
            throw new ValidationError({
              message: ctx.i18n.__(`Your wallet is FROZEN`),
            })
          }

          const is_valid_wallet = await verifyMainWallet(mainWallet)
          if (!is_valid_wallet) {
            throw new ValidationError({
              message: ctx.i18n.__('invalid_main_wallet'),
            })
          }

          const balance = await getMainWalletBalance(mainWallet, ctx.prisma)
          if (balance < amount) {
            throw new ValidationError({
              message: ctx.i18n.__('not_enough_balance'),
            })
          }

          // sometime if user wan't withdraw when amount < fee flat, so don't need check, so comment this check
          if (fee >= amount) {
            throw new ValidationError({
              message: ctx.i18n.__('Fee is greater than amount'),
            })
          }

          // check min,  max withdraw
          if (amount < currency.min_withdraw) {
            throw new ValidationError({
              message: ctx.i18n.__(
                'Min withdraw is %@'.replace('%@', `${currency.min_withdraw}`),
              ),
            })
          }
          if (amount > currency.max_withdraw) {
            throw new ValidationError({
              message: ctx.i18n.__(
                'Max withdraw is %@'.replace('%@', `${currency.max_withdraw}`),
              ),
            })
          }
          if (amount > currency.max_daily_withdraw) {
            throw new ValidationError({
              message: ctx.i18n.__(
                'Max daily withdraw is %@'.replace(
                  '%@',
                  `${currency.max_daily_withdraw}`,
                ),
              ),
            })
          }

          let is_notify_admin = true
          // if (amount > currency.withdraw_manual_threshold) {
          //   is_notify_admin = true
          // }

          // get estimate usd
          // const estimate_usd = math.mul(amount, price).toNumber()

          let transaction = await ctx.prisma.mainWalletTransaction.create({
            data: {
              User: {
                connect: {
                  id: ctx.user,
                },
              },
              Currency: {
                connect: {
                  id: currency_id,
                },
              },
              address,
              amount,
              tx_type: 'WITHDRAW',
              fee: fee,
              confirmation: 0,
              status: 'PENDING',
              is_notified_admin: is_notify_admin,
            },
            include: {
              User: true,
            },
          })

          await ctx.prisma.mainWalletChange.create({
            data: {
              MainWallet: {
                connect: {
                  id: mainWallet.id,
                },
              },
              amount: -amount,
              event_id: transaction.id,
              event_type: 'TRANSACTION',
            },
          })

          if (is_notify_admin) {
            notifyThresholdWithdrawTransaction(
              transaction.id,
              currency.symbol,
              transaction.User.username,
              transaction.amount,
              transaction.createdAt.toTimeString(),
            )
          }
          ctx.pubsub.publish('notify-withdraw', {
            username: user.username,
            symbol: currency.symbol,
            amount: amount - fee,
            address,
          })

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

    t.field('internalTransfer', {
      type: 'WithdrawPayload',
      args: {
        reciever: stringArg({ required: true }),
        amount: floatArg({ required: true }),
        currencyId: stringArg({ required: true }),
        otpToken: stringArg({ required: true }),
      },
      resolve: async (_, { amount, reciever, currencyId, otpToken }, ctx) => {
        throw new ValidationError({
          message: ctx.i18n.__(`Internal transfer is disabled`),
        })
        // if (!mainWalletTransferLock.has(`main_wallet_transfer_${ctx.user}`)) {
        //   mainWalletTransferLock.set(
        //     `main_wallet_transfer_${ctx.user}`,
        //     new Mutex(),
        //   )
        // }
        // const release = await mainWalletTransferLock
        //   .get(`main_wallet_transfer_${ctx.user}`)
        //   .acquire()
        const lock = await ctx.redlock.lock(
          `lock:main_wallet_transfer:${ctx.user}`,
          3000,
        )

        try {
          await checkTokenTwoFaEnabled(otpToken, ctx.user, ctx.prisma, ctx.i18n)

          if (amount <= 0) {
            throw new ValidationError({
              message: ctx.i18n.__('Amount too low'),
            })
          }

          const recieverUser = await ctx.prisma.user.findUnique({
            where: {
              username: reciever,
            },
          })

          if (!recieverUser)
            throw new ValidationError({
              message: ctx.i18n.__('Cannot find recipient'),
            })

          const senderUser = await ctx.prisma.user.findUnique({
            where: { id: ctx.user },
          })

          logger.info(
            `[Wallet.internalTransfer] User ${senderUser.email} send ${amount} to ${recieverUser.email}`,
          )

          const senderWallets = await ctx.prisma.mainWallet.findMany({
            where: {
              user_id: ctx.user,
              currency_id: currencyId,
            },
          })
          const senderWallet = senderWallets[0]

          const senderWalletBalance = await getMainWalletBalance(
            senderWallet,
            ctx.prisma,
          )
          logger.info(
            `[Wallet.internalTransfer] Sender wallet balance: ${senderWalletBalance}`,
          )
          if (senderWalletBalance < amount)
            throw new ValidationError({
              message: ctx.i18n.__('not_enough_balance'),
            })

          const recieverWallets = await ctx.prisma.mainWallet.findMany({
            where: {
              user_id: recieverUser.id,
              currency_id: currencyId,
            },
            take: 1,
          })
          const recieverWallet = recieverWallets[0]

          if (!recieverWallet)
            throw new ValidationError({
              message: ctx.i18n.__('Cannot find receiver wallet'),
            })

          logger.info(
            `[Wallet.internalTransfer] Receiver wallet: `,
            recieverWallet,
          )

          const transactionId = nanoid()

          const sendTransaction = ctx.prisma.mainWalletTransaction.create({
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
              amount,
              tx_type: 'SEND',
              tx_hash: transactionId,
              address: recieverUser.username || recieverUser.email,
              status: 'SUCCEED',
              fee: 0,
            },
          })
          const recieveTransaction = ctx.prisma.mainWalletTransaction.create({
            data: {
              Currency: {
                connect: {
                  id: currencyId,
                },
              },
              User: {
                connect: {
                  id: recieverUser.id,
                },
              },
              amount,
              tx_type: 'RECEIVE',
              tx_hash: transactionId,
              address: senderUser.username || senderUser.email,
              status: 'SUCCEED',
              fee: 0,
            },
          })

          const [sendTxResult, recieveTxResult] = await ctx.prisma.$transaction(
            [sendTransaction, recieveTransaction],
          )

          const createSenderWalletChange = ctx.prisma.mainWalletChange.create({
            data: {
              MainWallet: {
                connect: {
                  id: senderWallet.id,
                },
              },
              amount: -amount,
              event_id: sendTxResult.id,
              event_type: 'TRANSACTION',
            },
          })

          const createRecieverWalletChange = ctx.prisma.mainWalletChange.create(
            {
              data: {
                MainWallet: {
                  connect: {
                    id: recieverWallet.id,
                  },
                },
                amount,
                event_id: recieveTxResult.id,
                event_type: 'TRANSACTION',
              },
            },
          )

          await ctx.prisma.$transaction([
            createSenderWalletChange,
            createRecieverWalletChange,
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

export const ListUserWallets = extendType({
  type: 'Query',
  definition: (t) => {
    t.list.field('userWallets', {
      type: 'MainWallet',
      args: {
        skip: intArg(),
        limit: intArg({ default: 10 }),
      },
      resolve: async (parent, { skip, limit }, ctx) => {
        const mainWallets = await ctx.prisma.mainWallet.findMany({
          where: {
            user_id: ctx.user,
          },
          skip,
          take: limit,
        })

        const res = mainWallets.map(async (i) => {
          const balance = await getMainWalletBalance(i, ctx.prisma)
          return {
            ...i,
            balance,
          }
        })

        return await Promise.all(res)
      },
    })
  },
})
