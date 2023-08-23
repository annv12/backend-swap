import {
  objectType,
  extendType,
  intArg,
  arg,
  stringArg,
  floatArg,
} from 'nexus'
import { checkTokenTwoFaEnabled } from '../lib/auth-utils'
import { getMainWalletBalance } from '../utils'
import math from '../lib/math'
import { notifyThresholdWithdrawTransaction } from '../lib/notify-utils'
import { verifyMainWallet } from '../lib/main-wallet-utils'
import { ValidationError } from '../lib/error-util'

export const MainWalletTransaction = objectType({
  name: 'MainWalletTransaction',
  definition: (t) => {
    t.model.id()
    t.model.createdAt()
    t.model.updatedAt()
    t.model.User()
    t.model.Currency()
    t.model.amount()
    t.model.estimate_usd()
    t.model.tx_type()
    t.model.tx_hash()
    t.model.fee()
    t.model.status()
    t.model.confirmation()
    t.model.address()
    t.model.approved_at()
    t.model.approved_status()
    t.model.approved_by()
    t.model.extra_data()
    t.model.is_notified_admin()
  },
})

export const MainWalletTransactionAggregate = objectType({
  name: 'MainWalletTransactionAggregate',
  definition: (t) => {
    t.int('count')
  },
})
export const ListUserMainWalletTransactions = extendType({
  type: 'Query',
  definition: (t) => {
    t.list.field('userMainWalletTransactions', {
      type: 'MainWalletTransaction',
      args: {
        skip: intArg(),
        limit: intArg({ default: 10 }),
        currency_id: stringArg({ nullable: true }),
        type: arg({ type: 'TransactionType', nullable: true }),
      },
      resolve: async (parent, { skip, limit, currency_id, type }, ctx) => {
        const res = await ctx.prisma.mainWalletTransaction.findMany({
          where: {
            user_id: ctx.user,
            currency_id,
            tx_type: type,
          },
          skip,
          take: limit,
          orderBy: {
            createdAt: 'desc',
          },
        })

        return res
      },
    })

    t.field('mainWallettransactionAggregate', {
      type: 'MainWalletTransactionAggregate',
      resolve: async (_, args, ctx) => {
        const count = await ctx.prisma.mainWalletTransaction.count({
          where: {
            user_id: ctx.user,
          },
        })

        return { count }
      },
    })
  },
})

type BankInfo = {
  withdrawal_bank: string[]
}

export const transactionMut = extendType({
  type: 'Mutation',
  definition: (t) => {
    t.field('withdrawVND', {
      type: 'WithdrawPayload',
      args: {
        bank: stringArg({ required: true }),
        accountName: stringArg({ required: true }),
        accountNumber: stringArg({ required: true }),
        amount: floatArg({ required: true }),
        otpToken: stringArg({ required: true }),
      },
      resolve: async (
        parent,
        { bank, accountName, accountNumber, amount, otpToken },
        ctx,
      ) => {
        // if (!withdrawVNDlocks.has(`withdraw_vnd_${ctx.user}`)) {
        //   withdrawVNDlocks.set(`withdraw_vnd_${ctx.user}`, new Mutex())
        // }
        // const release = await withdrawVNDlocks
        //   .get(`withdraw_vnd_${ctx.user}`)
        //   .acquire()
        const lock = await ctx.redlock.lock(
          `lock:withdraw_vnd:${ctx.user}`,
          3000,
        )

        try {
          // check 2fa enabled, token
          await checkTokenTwoFaEnabled(otpToken, ctx.user, ctx.prisma, ctx.i18n)
          // first get currency info
          let currencies = await ctx.prisma.currency.findMany({
            where: {
              crypto_service: 'BANK',
            },
            take: 1,
          })
          if (!currencies || currencies.length === 0) {
            throw new ValidationError({
              message: ctx.i18n.__('Currency not found'),
            })
          }
          let currency = currencies[0]
          // check currency enabled
          if (!currency || !currency.is_enable) {
            throw new ValidationError({
              message: ctx.i18n.__('Currency not enable'),
            })
          }
          // check enable bank to receive

          if (!currency.crypto_data) {
            throw new ValidationError({
              message: ctx.i18n.__('Bank not enable to withdraw'),
            })
          }
          let bankObj = currency.crypto_data as BankInfo

          if (!bankObj || bankObj.withdrawal_bank.indexOf(bank) < 0) {
            throw new ValidationError({
              message: ctx.i18n.__('Bank not enable to withdraw'),
            })
          }
          if (!currency.is_enable_withdraw) {
            // check enable_withdraw
            throw new ValidationError({
              message: ctx.i18n.__('Withdraw not enable'),
            })
          }
          // check address valid
          // get fee
          if (
            currency.withdraw_fee_pct === null ||
            currency.withdraw_fee_flat === null
          ) {
            throw new ValidationError({
              message: ctx.i18n.__('Withdraw fee not configed'),
            })
          }
          let fee = math
            .add(
              math
                .mul(amount.toString(), currency.withdraw_fee_pct.toString())
                .toString(),
              currency.withdraw_fee_flat.toString(),
            )
            .toNumber()

          // check balance
          const mainWallets = await ctx.prisma.mainWallet.findMany({
            where: {
              user_id: ctx.user,
              currency_id: currency.id,
            },
          })
          if (!mainWallets || mainWallets.length === 0) {
            throw new ValidationError({
              message: ctx.i18n.__('Please create wallet first'),
            })
          }
          const mainWallet = mainWallets[0]

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
          // if (fee >= amount) {
          //   throw Error('Fee is greater than amount')
          // }
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

          const bankData = {
            to_bank: bank,
            to_account_name: accountName,
          }

          let transaction = await ctx.prisma.mainWalletTransaction.create({
            data: {
              User: {
                connect: {
                  id: ctx.user,
                },
              },
              Currency: {
                connect: {
                  id: currency.id,
                },
              },
              address: accountNumber,
              amount,
              tx_type: 'WITHDRAW',
              fee: fee,
              confirmation: 0,
              status: 'PENDING',
              is_notified_admin: is_notify_admin,
              extra_data: bankData,
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
