import {
  objectType,
  extendType,
  intArg,
  arg,
  stringArg,
  floatArg,
  enumType,
  booleanArg,
} from 'nexus'
import { ValidationError } from '../../lib/error-util'
import * as math from '../../lib/math'
import { getOrderByQuery } from '../../lib/utils'
import { getMainWalletBalanceMap } from '../../utils'
import { getAllExchangeBalance } from './exchange'
import { getUSDTPrice } from '../../lib/convert-utils'
import { checkPermissions } from '../../lib/auth-utils'
import {
  // getTransactionAmount,
  sendWithdrawRequestToCryptoService,
} from '../../lib/main-wallet-utils'
import logger from '../../lib/logger'
import { Prisma, TransactionStatus as PrismaTransactionStatus } from '@prisma/client'
import config from '../../config'

interface TransactionSumary {
  withdraw: number
  pending_withdraw: number
  deposit: number
  currency_id: string
}
interface ConvertionSumary {
  out_main: number
  in_main: number
  out_exchange: number
  in_exchange: number
  main_wallet_id: string
}

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

export const orderConnectionPayload = objectType({
  name: 'OrderConnectionPayload',
  definition: (t) => {
    t.list.field('nodes', {
      type: 'Order',
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

    t.field('ad_order', {
      type: 'OrderConnectionPayload',
      args: {
        skip: intArg({ default: 0 }),
        limit: intArg({ default: 10 }),
        round_id: intArg({ nullable: true }),
        username: stringArg({ nullable: true }),
        user_id: stringArg({ nullable: true }),
        account_type: arg({ type: 'AccountType' }),
      },
      resolve: async (
        parent,
        { skip, limit, username, user_id, account_type, round_id },
        ctx,
      ) => {
        let where: Prisma.OrderWhereInput = {}
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
        if (round_id) {
          where = {
            ...where,
            round_id: round_id,
          }
        }

        if (account_type === 'DEMO') {
          const nodes = await ctx.prisma.orderDemo.findMany({
            where,
            skip,
            take: limit,
            orderBy: {
              createdAt: 'desc',
            },
          })
          const total = await ctx.prisma.orderDemo.count({
            where,
          })
          return {
            nodes,
            total,
          }
        }

        if (account_type) {
          where = {
            ...where,
            account_type,
          }
        }
        const nodes = await ctx.prisma.order.findMany({
          where,
          skip,
          take: limit,
          orderBy: {
            createdAt: 'desc',
          },
        })

        const total = await ctx.prisma.order.count({
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

    t.field('transactionDetail', {
      type: 'TransactionDetail',
      args: {
        id: stringArg({ nullable: false }),
        nextIsNotifiedAdmin: booleanArg({ nullable: true }),
      },
      resolve: async (_, { id, nextIsNotifiedAdmin }, ctx) => {
        await checkPermissions(ctx, ['CAN_VIEW_TRANSACTION'])
        // transaction info
        let transaction = await ctx.prisma.mainWalletTransaction.findUnique({
          where: {
            id,
          },
        })

        if (nextIsNotifiedAdmin) {
          let transactions = await ctx.prisma.mainWalletTransaction.findMany({
            where: {
              is_notified_admin: true,
              status: 'PENDING',
              approved_status: null,
            },
          })
          if (transactions && transactions.length > 0) {
            transaction = transactions[0]
          }
        }
        if (!transaction) {
          throw Error('Transaction not found')
        }
        let user_id = transaction.user_id
        // cache usdt price with earch currency
        let wallets = await ctx.prisma.mainWallet.findMany({
          where: {
            user_id,
          },
          include: {
            Currency: true,
          },
        })
        if (!wallets || wallets.length === 0) {
          throw Error('Wallets not found')
        }
        let withdraw = 0 // succed
        let pendingWithdraw = 0
        let deposit = 0
        let balance = 0
        let convertIn = 0
        let convertOut = 0
        let manualIn = 0

        let bet = 0
        let win = 0
        let ref = 0
        let transferIn = 0
        let transferOut = 0
        let promotionCode = 0
        let promotion = 0
        let refund = 0
        let agency = 0
        let convertInExchange = 0
        let convertOutExchange = 0
        let manualInExchange = 0

        let usdtWalletIdMap = new Map()
        let usdtCurrencyIdMap = new Map()

        // exchange balance
        let exchangeBalancePrm = getAllExchangeBalance(ctx, user_id)
        // cache usdt rate and get promise wallet balance
        let balancePrms: Promise<Map<string, number>>[] = []
        for (let item of wallets) {
          // get balance
          balancePrms.push(getMainWalletBalanceMap(item, ctx.prisma))
        }

        for (let item of wallets) {
          let usdtRate
          // cache usdt rate
          if (config.priceConfigableCurrencies.has(item.Currency.symbol)) {
            usdtRate = item.Currency.admin_config_price
          } else {
            usdtRate = await getUSDTPrice(item.Currency.symbol, ctx.prisma)
          }
          // console.log('usdt: ', usdt)
          usdtWalletIdMap.set(item.id, usdtRate)
          usdtCurrencyIdMap.set(item.currency_id, usdtRate)
        }
        let balances = await Promise.all(balancePrms)
        for (let item of balances) {
          let usdtRate = usdtWalletIdMap.get(item.get('id')) ?? 0
          const estimateUsd = math
            .mul(item.get('balance') ?? 0, usdtRate)
            .toNumber()
          balance = math.add(estimateUsd, balance).toNumber()
        }
        let exchangeBalance = await exchangeBalancePrm

        // transaction sumary

        let transactions: [TransactionSumary] = await ctx.prisma.$queryRaw(Prisma.sql`
        select 
        SUM(CASE WHEN (tx_type='WITHDRAW' AND status='SUCCEED') THEN amount ELSE 0 END) as withdraw,
        SUM(CASE WHEN (tx_type='WITHDRAW' AND status='PENDING') THEN amount ELSE 0 END) as pending_withdraw,
        SUM(CASE WHEN (tx_type='DEPOSIT' AND status='SUCCEED') THEN amount ELSE 0 END) as deposit,
        currency_id
        from "main_wallet_transaction"
        WHERE user_id=${user_id}
        GROUP BY currency_id
        `)

        for (let item of transactions) {
          let estimateUsd = math
            .mul(item.withdraw, usdtCurrencyIdMap.get(item.currency_id))
            .toNumber()
          withdraw = math.add(estimateUsd, withdraw).toNumber()
          // pending withdraw
          estimateUsd = math
            .mul(item.pending_withdraw, usdtCurrencyIdMap.get(item.currency_id))
            .toNumber()
          pendingWithdraw = math.add(estimateUsd, pendingWithdraw).toNumber()
          // deposit
          estimateUsd = math
            .mul(item.deposit, usdtCurrencyIdMap.get(item.currency_id))
            .toNumber()
          deposit = math.add(estimateUsd, deposit).toNumber()
        }
        // get convert sumary

        let convertions: [ConvertionSumary] = await ctx.prisma.$queryRaw(Prisma.sql`
        select 
SUM(CASE WHEN (direction='MAIN_TO_EXCHANGE') THEN amount ELSE 0 END) as out_main,
SUM(CASE WHEN (direction='EXCHANGE_TO_MAIN') THEN converted_amount ELSE 0 END) as in_main,

SUM(CASE WHEN (direction='MAIN_TO_EXCHANGE') THEN converted_amount ELSE 0 END) as in_exchange,
SUM(CASE WHEN (direction='EXCHANGE_TO_MAIN') THEN amount ELSE 0 END) as out_exchange,

main_wallet_id
from "convertion_transaction"
WHERE user_id=${user_id}
GROUP BY main_wallet_id
        `)
        for (let item of convertions) {
          // convert in usd
          let estimateUsd = math
            .mul(item.in_main, usdtWalletIdMap.get(item.main_wallet_id))
            .toNumber()
          convertIn = math.add(estimateUsd, convertIn).toNumber()
          // convert out usd
          estimateUsd = math
            .mul(item.out_main, usdtWalletIdMap.get(item.main_wallet_id))
            .toNumber()
          convertOut = math.add(estimateUsd, convertOut).toNumber()
          // convert in/out exchange amount
          convertInExchange = math
            .add(item.in_exchange, convertInExchange)
            .toNumber()
          convertOutExchange = math
            .add(item.out_exchange, convertOutExchange)
            .toNumber()
        }

        // transfer in/out

        let transfers = await ctx.prisma.$queryRaw<any[]>(Prisma.sql`
          select SUM(amount) as amount, tx_type
          FROM "internal_transaction"
          WHERE user_id=${user_id} AND status='SUCCEED'
          GROUP BY tx_type
        `)
        for (let item of transfers) {
          if (item.tx_type === 'RECEIVE') {
            transferIn = item.amount
          } else if (item.tx_type === 'SEND') {
            transferOut = item.amount
          }
        }
        // PROMOTION CODE
        interface PromotionCodeSumary {
          amount: number
        }
        let promotionCodeResult: [PromotionCodeSumary] = await ctx.prisma
          .$queryRaw(Prisma.sql`
            select
              SUM(pc.amount) as amount
            from "promotion_code_transaction" as pt, "promotion_code" as pc
            WHERE pc.id = pt.promotion_code_id and pt.user_id=${user_id}
        `)
        if (promotionCodeResult.length > 0) {
          promotionCode = promotionCodeResult[0].amount
        }

        // aggregate
        let aggregates = await Promise.all([
          ctx.prisma.order.aggregate({
            where: {
              user_id,
              account_type: {
                not: 'DEMO',
              },
            },
            _sum: {
              bet_amount: true,
            },
          }),
          ctx.prisma.orderResult.aggregate({
            where: {
              user_id,
              Order: {
                account_type: {
                  not: 'DEMO',
                },
              },
            },
            _sum: {
              win_amount: true,
            },
          }),
          ctx.prisma.refTransaction.aggregate({
            where: {
              sponsor_id: user_id,
            },
            _sum: {
              earned: true,
            },
          }),
          ctx.prisma.promotionTransaction.aggregate({
            where: {
              user_id,
            },
            _sum: {
              amount: true,
            },
          }),
          ctx.prisma.refundTransaction.aggregate({
            where: {
              user_id,
            },
            _sum: {
              amount: true,
            },
          }),
          ctx.prisma.agencyLicenceTransaction.aggregate({
            where: {
              user_id,
            },
            _sum: {
              amount: true,
            },
          }),
        ])
        bet = aggregates[0]._sum.bet_amount
        win = aggregates[1]._sum.win_amount
        ref = aggregates[2]._sum.earned
        promotion = aggregates[3]._sum.amount
        refund = aggregates[4]._sum.amount
        agency = aggregates[5]._sum.amount
        // manual
        let manualResults = await ctx.prisma.manualTransaction.findMany({
          where: {
            user_id,
          },
        })
        for (let item of manualResults) {
          if (item.detination_type === 'MAIN_WALLET') {
            let estimateUsd = math
              .mul(item.amount, usdtWalletIdMap.get(item.destination_id))
              .toNumber()
            manualIn = math.add(estimateUsd, manualIn).toNumber()
          } else {
            manualInExchange = math
              .add(item.amount, manualInExchange)
              .toNumber()
          }
        }
        // console.log('mainToExchange: ', mainToExchange)
        return {
          transaction,
          exchange: {
            convertIn: convertInExchange,
            convertOut: convertOutExchange,
            bet,
            win,
            ref,
            transferIn,
            transferOut,
            promotionCode,
            promotion,
            refund,
            agency,
            balance: exchangeBalance,
            manualIn: manualInExchange,
            totalIn: math.addMultiples([
              convertInExchange,
              win,
              ref,
              transferIn,
              promotionCode,
              promotion,
              refund,
              manualInExchange,
            ]),
            totalOut: math.addMultiples([
              convertOutExchange,
              bet,
              agency,
              transferOut,
            ]),
          },
          wallet: {
            deposit,
            convertIn,
            withdraw,
            pendingWithdraw,
            convertOut,
            balance,
            manualIn: manualIn,
            totalIn: math.addMultiples([deposit, convertIn, manualIn]),
            totalOut: math.addMultiples([
              withdraw,
              pendingWithdraw,
              convertOut,
            ]),
          },
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
          if (transaction.Currency.crypto_service === 'TRON') {
            try {
              await sendWithdrawRequestToCryptoService(
                transaction.address,
                math.sub(transaction.amount, transaction.fee).toNumber(),
                transaction.id,
              )
            } catch (err) {
              logger.error(`Send withdraw request to crypto-serice error`, err)
              // await ctx.prisma.mainWalletTransaction.delete({
              //   where: { id: transaction.id },
              // })
              throw new ValidationError({
                message: ctx.i18n.__(
                  'Send withdraw request to crypto service failed',
                ),
              })
            }
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
