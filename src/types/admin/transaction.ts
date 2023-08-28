import {
  objectType,
  extendType,
  intArg,
  arg,
  stringArg,
  floatArg,
  enumType,
} from 'nexus'
import { ValidationError } from '../../lib/error-util'
import * as math from '../../lib/math'
import { getOrderByQuery } from '../../lib/utils'
import { checkPermissions } from '../../lib/auth-utils'
import { TransactionStatus as PrismaTransactionStatus } from '@prisma/client'
import { ETHCryptoData, ETHEncryptData } from '../../jobs/ethereum-job'
import { ethers } from 'ethers'
import { getNativeBalance } from '../../lib/moralis-v2-utils'
import { getTokenBalance, sendEthTransactionByChain } from '../../eth-service'
import { pushNotication } from 'src/lib/notify-utils'
import { format } from 'date-fns'

export const hashTransactionInfoPayload = objectType({
  name: 'HashTransactionInfoPayload',
  definition: (t) => {
    t.string('tx_hash')
    t.string('symbol')
    t.float('amount')
  },
})

export const transactionPagination = objectType({
  name: 'TransactionPagination',
  definition: (t) => {
    t.list.field('nodes', {
      type: 'MainWalletTransaction',
      nullable: true,
    })
    t.int('total')
  },
})
export const currencyConnectionPayload = objectType({
  name: 'CurrencyConnectionPayload',
  definition: (t) => {
    t.list.field('nodes', {
      type: 'Currency',
      nullable: true,
    })
    t.int('total')
  },
})
export const mainWalletConnectionPayload = objectType({
  name: 'MainWalletConnectionPayload',
  definition: (t) => {
    t.list.field('nodes', {
      type: 'MainWallet',
      nullable: true,
    })
    t.int('total')
  },
})

export const TransactionStatus = enumType({
  name: 'TransactionStatus',
  members: ['PENDING', 'SUCCEED', 'FAILED'],
})

export const TransactionApproveStatus = enumType({
  name: 'TransactionApproveStatus',
  members: ['APPROVED', 'REJECTED'],
})

export const exchangeSumaryResponse = objectType({
  name: 'ExchangeSumary',
  definition: (t) => {
    t.field('main', {
      type: 'ExchangeDetail',
    })
    t.field('promotion', {
      type: 'ExchangeDetail',
    })
    t.field('demo', {
      type: 'ExchangeDetail',
    })
  },
})

export const walletSumary = objectType({
  name: 'WalletSumary',
  definition: (t) => {
    t.float('deposit', { nullable: true })
    t.float('withdraw', { nullable: true })
    t.float('pendingWithdraw', { nullable: true })
    t.float('balance', { nullable: true })
    t.float('convertIn', { nullable: true })
    t.float('convertOut', { nullable: true })
    t.float('manualIn', { nullable: true })
    t.float('totalIn', { nullable: true })
    t.float('totalOut', { nullable: true })
  },
})

export const transactionDetail = objectType({
  name: 'TransactionDetail',
  definition: (t) => {
    t.field('exchange', {
      type: 'ExchangeWalletSumary',
    })
    t.field('transaction', {
      type: 'MainWalletTransaction',
    })
    t.field('wallet', {
      type: 'WalletSumary',
    })
  },
})

export const adCheckAddress = objectType({
  name: 'AdCheckAddress',
  definition(t) {
    t.field('walletAddress', { type: 'MainWalletAddress' })
    t.field('mainWallet', { type: 'MainWallet' })
  },
})

export const adTransactionQuery = extendType({
  type: 'Query',
  definition: (t) => {
    t.field('ad_currency', {
      type: 'CurrencyConnectionPayload',
      args: {
        skip: intArg(),
        limit: intArg({ default: 10 }),
        // type: arg({ type: 'TransactionType', nullable: true }),
      },
      resolve: async (parent, { skip, limit }, ctx) => {
        const nodes = await ctx.prisma.currency.findMany({
          skip,
          take: limit,
          orderBy: {
            createdAt: 'desc',
          },
        })
        const total = await ctx.prisma.currency.count()
        return {
          nodes,
          total,
        }
      },
    })

    t.field('ad_check_address', {
      type: 'AdCheckAddress',
      args: {
        address: stringArg(),
      },
      resolve: async (parent, args, ctx) => {
        const walletAddress = await ctx.prisma.mainWalletAddress.findFirst({
          where: { address: { equals: args.address } },
        })
        const mainWallet = await ctx.prisma.mainWallet.findUnique({
          where: { id: walletAddress.main_wallet_id },
        })

        return {
          walletAddress,
          mainWallet,
        }
      },
    })

    t.field('ad_wallet', {
      type: 'MainWalletConnectionPayload',
      args: {
        skip: intArg(),
        limit: intArg({ default: 10 }),
        username: stringArg({ nullable: true }),
        address: stringArg({ nullable: true }),
        currency_id: stringArg({ nullable: true }),
        search: stringArg({ nullable: true }),
      },
      resolve: async (
        parent,
        { skip, limit, username, address, currency_id, search },
        ctx,
      ) => {
        await checkPermissions(ctx, ['CAN_VIEW_WALLET'])
        let where = {}
        if (search) {
          where = {
            OR: [
              {
                User: {
                  username: {
                    contains: search,
                  },
                },
              },
              {
                MainWalletAddress: {
                  address: {
                    contains: search,
                  },
                },
              },
            ],
          }
        }
        if (username) {
          where = {
            ...where,
            User: {
              username: {
                contains: username,
              },
            },
          }
        }
        if (address) {
          where = {
            ...where,
            MainWalletAddress: {
              address: {
                contains: address,
              },
            },
          }
        }
        if (currency_id) {
          where = {
            ...where,
            currency_id,
          }
        }
        const nodes = await ctx.prisma.mainWallet.findMany({
          where,
          skip,
          take: limit,
        })
        const total = await ctx.prisma.mainWallet.count({
          where,
        })
        return {
          nodes,
          total,
        }
      },
    })
    //for withdraw, deposit
    t.field('ad_transaction', {
      type: 'TransactionPagination',
      args: {
        skip: intArg({ default: 0 }),
        limit: intArg({ default: 10 }),
        username: stringArg({ nullable: true }),
        user_id: stringArg({ nullable: true }),
        currency_id: stringArg({ nullable: true }),
        id: stringArg({ nullable: true }),
        status: arg({ type: 'TransactionStatus', nullable: true }),
        approved_status: arg({
          type: 'TransactionApproveStatus',
          nullable: true,
        }),
        type: arg({ type: 'TransactionType', nullable: true }),
        search: stringArg({ nullable: true }),
        orderBy: stringArg({ nullable: true }),
      },
      resolve: async (
        parent,
        {
          skip,
          limit,
          username,
          user_id,
          currency_id,
          type,
          search,
          orderBy,
          status,
          approved_status,
          id,
        },
        ctx,
      ) => {
        await checkPermissions(ctx, ['CAN_VIEW_TRANSACTION'])
        const { orderByField, order } = getOrderByQuery(
          orderBy,
          'createdAt desc',
        )
        let where = {
          id,
          approved_status,
          status,
          tx_type: type,
          user_id,
          currency_id,
          User: {
            username: {
              contains: username,
            },
          },
          OR: [
            {
              User: {
                username: {
                  contains: search,
                },
              },
            },
            {
              tx_hash: {
                contains: search,
              },
            },
            {
              address: {
                contains: search,
              },
            },
          ],
        }
        const result = await ctx.prisma.mainWalletTransaction.findMany({
          where,
          skip,
          take: limit,
          orderBy: {
            [orderByField]: order,
          },
        })
        const total = await ctx.prisma.mainWalletTransaction.count({
          where,
        })
        // const result = await ctx.prisma
        //   .$queryRaw`select *, COUNT(*) OVER () as total from "MainWalletTransaction" ORDER BY "createdAt" DESC  LIMIT ${limit} OFFSET ${skip}`
        return {
          nodes: result,
          total,
        }
      },
    })

    t.list.field('ad_transfer', {
      type: 'InternalTransaction',
      args: {
        skip: intArg(),
        limit: intArg({ default: 10 }),
        username: stringArg({ nullable: true }),
        user_id: stringArg({ nullable: true }),
        type: arg({ type: 'InternalTransactionType', nullable: true }),
        status: arg({ type: 'InternalTransactionStatus', nullable: true }),
      },
      resolve: async (
        parent,
        { skip, limit, username, user_id, type, status },
        ctx,
      ) => {
        await checkPermissions(ctx, ['CAN_VIEW_TRANSACTION'])
        let where = {}
        if (username) {
          where = {
            User: {
              username: {
                contains: username,
              },
            },
          }
        }
        if (user_id) {
          where = {
            user_id,
          }
        }
        if (type) {
          where = {
            ...where,
            tx_type: type,
          }
        }
        if (status) {
          where = {
            ...where,
            status,
          }
        }
        const result = ctx.prisma.internalTransaction.findMany({
          where,
          take: limit,
          skip,
          orderBy: {
            createdAt: 'desc',
          },
        })

        return result
      },
    })

    t.field('ad_checkTransactionHash', {
      type: 'HashTransactionInfoPayload',
      args: {
        hash: stringArg(),
        currency_id: stringArg(),
      },
      resolve: async (_, { hash, currency_id }, ctx) => {
        await checkPermissions(ctx, ['CAN_CHECK_TRANSACTION_HASH'])
        // check currency
        let currency = await ctx.prisma.currency.findUnique({
          where: {
            id: currency_id,
          },
        })
        if (!currency) {
          throw new ValidationError({
            message: ctx.i18n.__('Currency not found'),
          })
        }
        if (currency.crypto_service === 'BANK') {
          throw new ValidationError({
            message: ctx.i18n.__("Can't check this currency"),
          })
        }
        let transactions = await ctx.prisma.mainWalletTransaction.findMany({
          where: {
            tx_hash: hash,
            currency_id,
          },
          take: 1,
        })
        if (transactions && transactions.length > 0) {
          throw new ValidationError({
            message: ctx.i18n.__('Transaction hash existed'),
          })
        }
        // let amount = await getTransactionAmount(
        //   currency.symbol,
        //   hash,
        //   transactions[0].address,
        // )
        const amount = 0
        console.log('amount: ', amount)
        return {
          tx_hash: hash,
          symbol: currency.symbol,
          amount: amount,
        }
      },
    })
  },
})

export const addTransactionType = objectType({
  name: 'AddTransactionPayload',
  definition: (t) => {
    t.boolean('success')
  },
})

export const adTransactionMut = extendType({
  type: 'Mutation',
  definition: (t) => {
    t.field('ad_manualDeposit', {
      type: 'AddTransactionPayload',
      args: {
        user_id: stringArg({ required: true }),
        currency_id: stringArg({ required: true }),
        transaction_hash: stringArg({ required: true }),
        amount: floatArg({ required: true }),
      },
      resolve: async (
        _,
        { user_id, currency_id, transaction_hash, amount },
        ctx,
      ) => {
        await checkPermissions(ctx, ['CAN_CREATE_TRANSACTION'])
        // check not exist and is valid
        let transactions = await ctx.prisma.mainWalletTransaction.findMany({
          where: {
            tx_hash: transaction_hash,
          },
          take: 1,
        })
        if (transactions && transactions.length > 0) {
          throw new ValidationError({
            message: ctx.i18n.__('Transaction hash existed'),
          })
        }
        // check valid currency
        let currency = await ctx.prisma.currency.findUnique({
          where: {
            id: currency_id,
          },
        })
        if (!currency) {
          throw new ValidationError({
            message: ctx.i18n.__('Currency not exist'),
          })
        }
        if (!currency.is_enable) {
          throw new ValidationError({
            message: ctx.i18n.__('Currency not enable'),
          })
        }
        // check wallet valid
        let wallets = await ctx.prisma.mainWallet.findMany({
          where: {
            user_id,
            currency_id,
          },
          include: {
            MainWalletAddress: true,
          },
          take: 1,
        })
        if (!wallets || wallets.length === 0) {
          throw new ValidationError({
            message: ctx.i18n.__('Wallet not exist'),
          })
        }
        const wallet = wallets[0]
        if (wallet.is_frozen) {
          throw new ValidationError({
            message: ctx.i18n.__('The wallet is frozen'),
          })
        }

        // check user exist, is trader, and valid account
        let user = await ctx.prisma.user.findUnique({
          where: {
            id: user_id,
          },
          include: {
            UserProfile: true,
          },
        })
        if (!user) {
          throw new ValidationError({ message: ctx.i18n.__('User not exist') })
        }
        if (user.role !== 'TRADER') {
          throw new ValidationError({ message: ctx.i18n.__('User not trader') })
        }
        if (user.UserProfile.status !== 'NORMAL') {
          throw new ValidationError({
            message: ctx.i18n.__(`User is ${user.UserProfile.status}`),
          })
        }
        // add main wallet transaction, main wallet change
        let transaction = await ctx.prisma.mainWalletTransaction.create({
          data: {
            User: {
              connect: {
                id: user_id,
              },
            },
            Currency: {
              connect: {
                id: currency_id,
              },
            },
            address: wallet.MainWalletAddress.address,
            amount,
            tx_type: 'DEPOSIT',
            tx_hash: transaction_hash,
            fee: 0,
            confirmation: currency.required_confirmation,
            status: 'SUCCEED',
            is_notified_admin: false,
            is_manual_deposit: true,
            approved_at: new Date(),
            approved_by: {
              connect: {
                id: ctx.user,
              },
            },
            approved_status: 'APPROVED',
          },
        })

        await ctx.prisma.mainWalletChange.create({
          data: {
            MainWallet: {
              connect: {
                id: wallet.id,
              },
            },
            amount: amount,
            event_id: transaction.id,
            event_type: 'TRANSACTION',
          },
        })
        return {
          success: true,
        }
      },
    })

    t.field('ad_updateTransaction', {
      type: 'MainWalletTransaction',
      args: {
        transaction_id: stringArg({ required: true }),
        status: arg({
          type: 'ApprovedStatus',
          required: true,
        }),
        reason: stringArg(),
      },
      resolve: async (_, { transaction_id, status, reason }, ctx) => {
        await checkPermissions(ctx, ['CAN_APPROVE_TRANSACTION'])
        // check transaction is valid
        let transaction = await ctx.prisma.mainWalletTransaction.findUnique({
          where: {
            id: transaction_id,
          },
          include: {
            Currency: true,
          },
        })

        if (!transaction) {
          throw new ValidationError({
            message: ctx.i18n.__('Transaction not exist'),
          })
        }
        if (
          transaction.is_notified_admin !== true ||
          transaction.status === 'SUCCEED'
        ) {
          // if transaction not need check or status is success or approved
          throw new ValidationError({
            message: ctx.i18n.__('Transaction not valid'),
          })
        }
        if (transaction.approved_status === status) {
          throw new ValidationError({
            message: ctx.i18n.__(`Transaction is ${status}`),
          })
        }
        if (status === 'REJECTED' && (!reason || reason.length === 0)) {
          throw new ValidationError({
            message: ctx.i18n.__('Reason not valid'),
          })
        }
        // update transaction
        let data: any = {
          approved_status: status,
          approved_at: new Date(),
          approved_by: {
            connect: {
              id: ctx.user,
            },
          },
        }
        if (status === 'REJECTED') {
          let extra = transaction.extra_data as any
          const extra_data: any = {
            ...extra,
            reject_reason: reason,
          }
          data = {
            ...data,
            status: PrismaTransactionStatus.FAILED,
            extra_data,
          }
        } else {
          try {
            const masterWallet = await ctx.prisma.masterWallet.findFirst({
              where: {
                Currency: {
                  symbol: transaction.Currency.symbol,
                },
              },
              include: {
                Currency: true,
              },
            })
            if (!masterWallet) {
              throw new ValidationError({
                message: ctx.i18n.__('Master wallet not exists'),
              })
            }

            const encrypt_data = masterWallet.encrypt_data as ETHEncryptData
            const fee_wallet_private_key = encrypt_data.private_key
            const master_wallet_address = encrypt_data.master_address

            const crypto_data = transaction.Currency
              .crypto_data as ETHCryptoData
            const minEth = ethers.utils
              .parseEther(crypto_data.min_eth_for_collect)
              .mul(transaction.Currency.symbol == 'ETH' ? 3 : 2)

            const nativeBalance = await getNativeBalance(
              master_wallet_address,
              masterWallet.Currency,
            )
            if (nativeBalance.lt(minEth)) {
              throw new ValidationError({
                message: ctx.i18n.__('Fee not enough'),
              })
            }
            let amount = ethers.utils.parseEther(
              math.sub(transaction.amount, transaction.fee).toString(),
            )
            let balance = ethers.BigNumber.from('0')
            if (transaction.Currency.symbol == 'BNB') {
              balance = nativeBalance.sub(minEth)
            } else {
              balance = await getTokenBalance(
                crypto_data.contract_address,
                master_wallet_address,
              )
            }
            if (amount.gt(balance)) {
              throw new ValidationError({
                message: ctx.i18n.__('Balance not enough'),
              })
            }
            const tx_hash = await sendEthTransactionByChain(
              fee_wallet_private_key,
              transaction.address,
              amount,
              crypto_data,
            )
            if (tx_hash) {
              data = {
                ...data,
                tx_hash,
              }
              ctx.user = transaction.user_id
              pushNotication(
                'WITHDRAW',
                ctx,
                null,
                `You have successfully withdrawn [${transaction.amount}] [${
                  transaction.Currency.symbol
                }] at [${format(
                  new Date(),
                  'HH:mm, dd/MM/yyyy',
                )}].\nIf this activity is not your own, please contact us immediately.`,
              )
            }
          } catch (error) {
            throw new ValidationError({
              message: error.message,
            })
          }
        }

        let result = await ctx.prisma.mainWalletTransaction.update({
          where: { id: transaction_id },
          data,
        })
        console.log('result: ', result)

        return result
      },
    })
  },
})
