import { objectType, extendType, intArg, stringArg, floatArg } from 'nexus'
import { getExchangeWalletBalance, getMainWalletBalance } from '../utils'
import {
  generateWalletAddress,
  verifyMainWallet,
  calculateFee,
  generateWalletAddressV2,
  sendWithdrawRequestToCryptoService,
} from '../lib/main-wallet-utils'
import { customAlphabet } from 'nanoid'
import logger from '../lib/logger'
import { checkTokenTwoFaEnabled } from '../lib/auth-utils'
import {
  notifyThresholdWithdrawTransaction,
  pushNotication,
  notifyTele,
} from '../lib/notify-utils'
import { getConvertPrice } from '../lib/convert-utils'
import { ValidationError } from '../lib/error-util'
import { format } from 'date-fns'
import math from '../lib/math'
import { watchAddress, watchBscAddress } from '../lib/moralis-utils'
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

export const ExchangeWallet = objectType({
  name: 'ExchangeWallet',
  definition: (t) => {
    t.model.id()
    t.model.createdAt()
    t.model.updatedAt()
    t.model.type()
    t.model.is_frozen()
    t.model.base_balance()
    t.float('balance', {
      resolve: async (root, arg, ctx) => {
        const wallet = await ctx.prisma.exchangeWallet.findUnique({
          where: { id: root.id },
        })
        return await getExchangeWalletBalance(wallet, ctx.prisma)
      },
    })
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

    t.field('refillDemoWallet', {
      type: 'ExchangeWallet',
      args: {},
      resolve: async (_, args, ctx) => {
        const userExWallets = await ctx.prisma.exchangeWallet.findMany({
          where: {
            user_id: ctx.user,
          },
        })

        const isDemoAccount =
          userExWallets.filter((i) => i.type === 'DEMO').length > 1
        const demoMain = userExWallets.sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        )

        const userWallet = isDemoAccount
          ? demoMain[0]
          : userExWallets.find((i) => i.type === 'DEMO')

        const demoWalletUpdated = await ctx.prisma.exchangeWallet.update({
          where: {
            id: userWallet.id,
          },
          data: {
            base_balance: 1000,
            balance_cache_datetime: new Date().toISOString(),
          },
        })

        return { ...demoWalletUpdated, balance: demoWalletUpdated.base_balance }
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
        // if (!withdrawLock.has(`withdraw_${ctx.user}`)) {
        //   withdrawLock.set(`withdraw_${ctx.user}`, new Mutex())
        // }
        // const release = await withdrawLock.get(`withdraw_${ctx.user}`).acquire()
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
          // check address valid
          // if (currency.regex) {
          //   const currencySymbol = currency.symbol.toLocaleLowerCase()
          //   const addressValid = walletAddressValidatorMinJs.validate(
          //     address,
          //     'trx',
          //   )
          //   if (!addressValid) {
          //     throw new ValidationError({
          //       message: ctx.i18n.__('Address not valid'),
          //     })
          //   }
          // }
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

          const mainWallets = await ctx.prisma.mainWallet.findMany({
            where: {
              user_id: ctx.user,
              currency_id: currency_id,
            },
            include: {
              MainWalletAddress: true,
            },
          })
          if (!mainWallets || mainWallets.length === 0) {
            throw new ValidationError({
              message: ctx.i18n.__('Wallet not found'),
            })
          }
          const mainWallet = mainWallets[0]

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

          let is_notify_admin = false
          if (amount > currency.withdraw_manual_threshold) {
            is_notify_admin = true
          }

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

          if (!is_notify_admin && currency.crypto_service === 'TRON') {
            try {
              await sendWithdrawRequestToCryptoService(
                address,
                math.sub(amount, fee).toNumber(),
                transaction.id,
              )
            } catch (err) {
              logger.error(`Send withdraw request to crypto-serice error`, err)
              await ctx.prisma.mainWalletTransaction.delete({
                where: { id: transaction.id },
              })
              throw new ValidationError({
                message: ctx.i18n.__(
                  'Send withdraw request to crypto service failed',
                ),
              })
            }
          }

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
          pushNotication(
            'WITHDRAW',
            ctx,
            null,
            `You have successfully withdrawn [${transaction.amount}] [${
              currency.symbol
            }] at [${format(
              new Date(),
              'HH:mm, dd/MM/yyyy',
            )}].\nIf this activity is not your own, please contact us immediately.`,
          )
          ctx.pubsub.publish('notify-withdraw', {
            username: user.username,
            symbol: currency.symbol,
            amount: amount - fee,
            address
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

    t.field('exchangeWalletInternalTransfer', {
      type: 'WithdrawPayload',
      args: {
        receiver: stringArg({ required: true }),
        amount: floatArg({ required: true }),
        otpToken: stringArg({ required: true }),
      },
      resolve: async (_, { amount, receiver, otpToken }, ctx) => {
        // throw Error(`Internal Transfer is DISABLED`)
        // if (!locks.has(`exchange_wallet_transfer_${ctx.user}`)) {
        //   locks.set(`exchange_wallet_transfer_${ctx.user}`, new Mutex())
        // }
        // const release = await locks
        //   .get(`exchange_wallet_transfer_${ctx.user}`)
        //   .acquire()
        const lock = await ctx.redlock.lock(
          `lock:exchange_wallet_transfer:${ctx.user}`,
          3000,
        )

        try {
          // check exist reciever
          const recieverUser = await ctx.prisma.user.findUnique({
            where: {
              username: receiver,
            },
            include: {
              UserProfile: true,
            },
          })

          if (!recieverUser) {
            throw new ValidationError({
              message: ctx.i18n.__('Cannot find recipient'),
            })
          }

          // check 2fa is enable and verify 2fa, bypass if admin config
          if (!recieverUser.UserProfile.admin_config_bypass_2fa) {
            await checkTokenTwoFaEnabled(otpToken, ctx.user, ctx.prisma, ctx.i18n)
          }

          if (amount <= 0) {
            throw new ValidationError({
              message: ctx.i18n.__('Amount too low'),
            })
          }
          // find sender info
          const senderUser = await ctx.prisma.user.findUnique({
            where: { id: ctx.user },
            include: {
              UserProfile: true,
            },
          })

          // check exist sender wallet
          const senderWallets = await ctx.prisma.exchangeWallet.findMany({
            where: {
              user_id: ctx.user,
              type: 'MAIN',
            },
            take: 1,
          })
          if (!senderWallets || senderWallets.length === 0) {
            throw new ValidationError({
              message: ctx.i18n.__('Cannot find wallet'),
            })
          }
          const senderWallet = senderWallets[0]

          if (senderWallet.is_frozen) {
            throw new ValidationError({
              message: ctx.i18n.__(`Your wallet is FROZEN`),
            })
          }

          const senderWalletBalance = await getExchangeWalletBalance(
            senderWallet,
            ctx.prisma,
          )
          logger.info(
            `[Wallet.exchangeWalletInternalTransfer] Sender wallet balance: ${senderWalletBalance}`,
          )
          // check balance
          if (senderWalletBalance < amount) {
            throw new ValidationError({
              message: ctx.i18n.__('not_enough_balance'),
            })
          }

          // check reciever is same with username of sender
          if (senderUser.username === receiver) {
            throw new ValidationError({
              message: ctx.i18n.__("Can't transfer yourself"),
            })
          }

          logger.info(
            `[Wallet.exchangeWalletInternalTransfer] User ${senderUser.email} send ${amount} to ${recieverUser.email}`,
          )
          // check user is agency
          // if (
          //   recieverUser.UserProfile.is_agency !== true &&
          //   senderUser.UserProfile?.is_agency !== true
          // ) {
          //   throw new ValidationError({
          //     message: ctx.i18n.__('User is not agency'),
          //   })
          // }

          // check exist receiver wallet
          const recieverWallets = await ctx.prisma.exchangeWallet.findMany({
            where: {
              user_id: recieverUser.id,
              type: 'MAIN',
            },
            take: 1,
          })
          const recieverWallet = recieverWallets[0]
          if (!recieverWallet)
            throw new ValidationError({
              message: ctx.i18n.__('Cannot find receiver wallet'),
            })
          logger.info(
            `[Wallet.exchangeWalletInternalTransfer] Receiver wallet: `,
            recieverWallet,
          )

          if (recieverWallet.is_frozen) {
            throw new ValidationError({
              message: ctx.i18n.__(`Your wallet is FROZEN`),
            })
          }

          // create exchagne transaction
          const transactionId = nanoid()
          const sendTransaction = ctx.prisma.internalTransaction.create({
            data: {
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
            },
          })
          const recieveTransaction = ctx.prisma.internalTransaction.create({
            data: {
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
            },
          })

          const [sendTxResult, recieveTxResult] = await ctx.prisma.$transaction(
            [sendTransaction, recieveTransaction],
          )

          // create exchagne wallet change
          const createSenderWalletChange =
            ctx.prisma.exchangeWalletChange.create({
              data: {
                ExchangeWallet: {
                  connect: {
                    id: senderWallet.id,
                  },
                },
                amount: -amount,
                event_id: sendTxResult.id,
                event_type: 'INTERNAL_TRANSACTION',
              },
            })

          const createRecieverWalletChange =
            ctx.prisma.exchangeWalletChange.create({
              data: {
                ExchangeWallet: {
                  connect: {
                    id: recieverWallet.id,
                  },
                },
                amount,
                event_id: recieveTxResult.id,
                event_type: 'INTERNAL_TRANSACTION',
              },
            })

          await ctx.prisma.$transaction([
            createSenderWalletChange,
            createRecieverWalletChange,
          ])
          pushNotication(
            'TRANSFER',
            ctx,
            null,
            `You have transfered [${amount}] [USD] to [${
              recieverUser.username
            }] at [${format(
              new Date(),
              'HH:mm, dd/MM/yyyy',
            )}].\n\nIf this activity is not your own, please contact us immediately.`,
          )

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

    t.list.field('userExchangeWallets', {
      type: 'ExchangeWallet',
      // args: {},
      resolve: async (_, args, ctx) => {
        const wallets = await ctx.prisma.exchangeWallet.findMany({
          where: {
            user_id: ctx.user,
          },
        })

        const result = wallets.map(async (i) => {
          const balance = await getExchangeWalletBalance(i, ctx.prisma)
          return {
            ...i,
            balance,
          }
        })

        const walletsWithBalance = await Promise.all(result)

        return walletsWithBalance.sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        )
      },
    })
  },
})
