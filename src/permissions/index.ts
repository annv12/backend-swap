import {
  isInstance as isApolloErrorInstance,
  formatError as formatApolloError,
  ApolloError,
  ErrorConfig,
} from 'apollo-errors'
import * as Sentry from "@sentry/node";
import { rule, shield, not, and, or } from 'graphql-shield'
import { AuthenticationError } from '../lib/error-util'
import { Context } from '../context'
import { fakeDeposit, fakeWithdraw } from '../services/fakeData/api';

const ALLOW_EXTERNAL_ERRORS = process.env.ALLOW_EXTERNAL_ERRORS === 'true'

Sentry.init({
  dsn: process.env.SENTRY_URL,
  enabled: true,
  beforeSend(error: any) {
    return error
  },
  debug: true,
})

async function getUserProfile(ctx: Context) {
  const userProfiles = await ctx.prisma.userProfile.findMany({
    where: { user_id: ctx.user },
  })
  return userProfiles[0]
}

const rules = {
  isAuthenticatedUser: rule()((parent, args, ctx: Context) => {
    if (ctx.user) {
      return true
    }
    return new AuthenticationError({ message: 'UNAUTHENTICATED' })
  }),
  isAdmin: rule()((parent, args, ctx: Context, info) => {
    if (ctx.role === 'ADMIN' || ctx.role === 'STAFF') {
      return true
    }
    return new AuthenticationError({ message: 'Not have permission' })
  }),
  isAccountBanned: rule()(async (parent, args, ctx: Context) => {
    const profile = await getUserProfile(ctx)
    return profile.status === 'BANNED'
  }),
  isAccountFrozen: rule()(async (parent, args, ctx: Context) => {
    const profile = await getUserProfile(ctx)
    return profile.status === 'FROZEN'
  }),
  isAccountSuspended: rule()(async (parent, args, ctx: Context) => {
    const profile = await getUserProfile(ctx)
    return profile.status === 'SUSPENDED'
  }),
}

const isAuthAndHealthy = and(
  rules.isAuthenticatedUser,
  not(
    rules.isAccountBanned,
    new AuthenticationError({ message: 'ACCOUNT BANNED' }),
  ),
)

const isAllowNormalMutation = and(
  rules.isAuthenticatedUser,
  not(
    rules.isAccountSuspended,
    new AuthenticationError({ message: 'ACCOUNT SUSPENDED' }),
  ),
  not(
    rules.isAccountBanned,
    new AuthenticationError({ message: 'ACCOUNT BANNED' }),
  ),
)

const isAllowSpendMoneyMutation = and(
  rules.isAuthenticatedUser,
  not(
    rules.isAccountSuspended,
    new AuthenticationError({ message: 'ACCOUNT SUSPENDED' }),
  ),
  not(
    rules.isAccountBanned,
    new AuthenticationError({ message: 'ACCOUNT BANNED' }),
  ),
  not(
    rules.isAccountFrozen,
    new AuthenticationError({ message: 'ACCOUNT FROZENED' }),
  ),
)

export const permissions = shield(
  {
    Query: {
      me: isAuthAndHealthy,
      dashboardStats: isAuthAndHealthy,
      userWallets: isAuthAndHealthy,
      userExchangeWallets: isAuthAndHealthy,
      userOrders: isAuthAndHealthy,
      userConvertions: isAuthAndHealthy,
      userMainWalletTransactions: isAuthAndHealthy,
      userRefStats: isAuthAndHealthy,
      userCommissions: isAuthAndHealthy,
      userInternalTransaction: isAuthAndHealthy,
      // refNetwork: isAuthAndHealthy,
      refChart: isAuthAndHealthy,
      // depositbank: isAuthAndHealthy,
      copyTradeActions: isAuthAndHealthy,
      copyTrades: isAuthAndHealthy,
      copyTrade: isAuthAndHealthy,
      copyTradeOrders: isAuthAndHealthy,
      copyTradeOrdersAggregate: isAuthAndHealthy,
      copyTradeLeaderSummary: isAuthAndHealthy,
      copyTradeCopierSummary: isAuthAndHealthy,
      // plan: isAuthAndHealthy,
      // plans: isAuthAndHealthy,
      expertRegisterCondition: isAuthAndHealthy,
      // userServiceSubscription: isAuthAndHealthy,
      experts: isAuthAndHealthy,
      expertsAggregate: isAuthAndHealthy,
      notifications: isAuthAndHealthy,
      notificationAggreagte: isAuthAndHealthy,
      unreadNotifyCount: isAuthAndHealthy,
      copyTradeCommissions: isAuthAndHealthy,
      copyTradeCommissionsAggregate: isAuthAndHealthy,
      buyPromotionCodeHistory: isAuthAndHealthy,
      giftCodePurchareHistory: isAuthAndHealthy,
      giftCodePurchareHistoryAggregate: isAuthAndHealthy,
      userInsuranceInfo: isAuthAndHealthy,
      userInsurances: isAuthAndHealthy,
      // userInsurancesDemo: isAuthAndHealthy,
      // admin query
      ad_currency: and(rules.isAuthenticatedUser, rules.isAdmin),
      ad_wallet: and(rules.isAuthenticatedUser, rules.isAdmin),
      ad_order: and(rules.isAuthenticatedUser, rules.isAdmin),
      ad_transaction: and(rules.isAuthenticatedUser, rules.isAdmin),
      ad_transfer: and(rules.isAuthenticatedUser, rules.isAdmin),
      userSumary: and(rules.isAuthenticatedUser, rules.isAdmin),
      searchUser: and(rules.isAuthenticatedUser, rules.isAdmin),
      // porfolio: and(rules.isAuthenticatedUser, rules.isAdmin),
      adminDashboard: and(rules.isAuthenticatedUser, rules.isAdmin),
      transactionDetail: and(rules.isAuthenticatedUser, rules.isAdmin),
      convertionSumary: and(rules.isAuthenticatedUser, rules.isAdmin),
      ad_convertion: and(rules.isAuthenticatedUser, rules.isAdmin),
      ad_checkTransactionHash: and(rules.isAuthenticatedUser, rules.isAdmin),
      roundTracking: and(rules.isAuthenticatedUser, rules.isAdmin),
      adminCurrencies: and(rules.isAuthenticatedUser, rules.isAdmin),
      // adminOrder: and(rules.isAuthenticatedUser, rules.isAdmin),
      adminConvertionPairs: and(rules.isAuthenticatedUser, rules.isAdmin),
      adminRefLevels: and(rules.isAuthenticatedUser, rules.isAdmin),
      adminRoundChart: and(rules.isAuthenticatedUser, rules.isAdmin),
      adminRefTree: and(rules.isAuthenticatedUser, rules.isAdmin),
      adminTradeMode: and(rules.isAuthenticatedUser, rules.isAdmin),

      // ticketCategories: and(rules.isAuthenticatedUser),
      // tickets: and(rules.isAuthenticatedUser),
      adminUsers: and(rules.isAuthenticatedUser, rules.isAdmin),
      adminUsersAggregate: and(rules.isAuthenticatedUser, rules.isAdmin),
      adminUser: and(rules.isAuthenticatedUser, rules.isAdmin),
      adminUserPorfolio: and(rules.isAuthenticatedUser, rules.isAdmin),
      adminRound: and(rules.isAuthenticatedUser, rules.isAdmin),
      adminRoundAggregate: and(rules.isAuthenticatedUser, rules.isAdmin),
      mainWalletChange: and(rules.isAuthenticatedUser, rules.isAdmin),
      exchangeWalletChange: and(rules.isAuthenticatedUser, rules.isAdmin),
      // statistic: and(rules.isAuthenticatedUser, rules.isAdmin),
      permissions: and(rules.isAuthenticatedUser, rules.isAdmin),
      expertsReport: and(rules.isAuthenticatedUser, rules.isAdmin),
      expertDetail: and(rules.isAuthenticatedUser, rules.isAdmin),
      adNotifications: and(rules.isAuthenticatedUser, rules.isAdmin),
    },
    Mutation: {
      createCopyTrade: and(rules.isAuthenticatedUser),
      updateCopyTrade: and(rules.isAuthenticatedUser),
      adjustCopyTrade: and(rules.isAuthenticatedUser),

      // createTicket: and(rules.isAuthenticatedUser),
      // replyTicket: and(rules.isAuthenticatedUser),
      submitExpertregistration: and(rules.isAuthenticatedUser),
      // cancelSubscription: and(rules.isAuthenticatedUser),
      registerDevice: and(rules.isAuthenticatedUser),
      logout: and(rules.isAuthenticatedUser),
      readAllNotify: and(rules.isAuthenticatedUser),
      updateExpertActiveStatus: and(rules.isAuthenticatedUser),
      // admin mutation
      createCurrency: and(rules.isAuthenticatedUser, rules.isAdmin),
      createExchangePair: and(rules.isAuthenticatedUser, rules.isAdmin),
      donation: and(rules.isAuthenticatedUser, rules.isAdmin),
      createPromotionCode: and(rules.isAuthenticatedUser, rules.isAdmin),
      generateToken: and(rules.isAuthenticatedUser, rules.isAdmin),
      ad_manualDeposit: and(rules.isAuthenticatedUser, rules.isAdmin),
      ad_updateTransaction: and(rules.isAuthenticatedUser, rules.isAdmin),
      // createCategory: and(rules.isAuthenticatedUser, rules.isAdmin),
      updateUser: and(rules.isAuthenticatedUser, rules.isAdmin),
      updateExpertStatus: and(rules.isAuthenticatedUser, rules.isAdmin),
      pushNotification: and(rules.isAuthenticatedUser, rules.isAdmin),
      manualSet: and(rules.isAuthenticatedUser, rules.isAdmin),
      adminUpdateOneCurrency: and(rules.isAuthenticatedUser, rules.isAdmin),
      adminRoundRequest: and(rules.isAuthenticatedUser, rules.isAdmin),
      adminUpdateOneConvertionPair: and(rules.isAuthenticatedUser, rules.isAdmin),
      adminUpdateOneRefLevel: and(rules.isAuthenticatedUser, rules.isAdmin),
      adminSetTradeMode: and(rules.isAuthenticatedUser, rules.isAdmin),

      createRef: and(rules.isAuthenticatedUser, rules.isAdmin),
      updateStatus: and(rules.isAuthenticatedUser, rules.isAdmin),
      sendGiftCode: and(rules.isAuthenticatedUser, rules.isAdmin),
      updateStatusSend: and(rules.isAuthenticatedUser, rules.isAdmin),

      // user not spend money mutation
      updateProfile: isAllowNormalMutation,
      createWalletRequest: isAllowNormalMutation,
      refillDemoWallet: isAllowNormalMutation,
      buyAgencyLicence: isAllowNormalMutation,
      changePassword: isAllowNormalMutation,
      disableTwoFactor: isAllowNormalMutation,
      enableTwoFactor: isAllowNormalMutation,
      createOrder: isAllowNormalMutation,
      uploadAvatar: isAllowNormalMutation,
      generateTemporaryToken: isAllowNormalMutation,
      enableTwoFactorMobile: isAllowNormalMutation,
      disableTwoFactorMobile: isAllowNormalMutation,
      // createExchangeWallet: isAllowNormalMutation,

      // user spend money mutation
      withdraw: isAllowSpendMoneyMutation,
      internalTransfer: isAllowSpendMoneyMutation,
      exchangeWalletInternalTransfer: isAllowSpendMoneyMutation,
      convertCurrency: isAllowSpendMoneyMutation,
      withdrawVND: isAllowSpendMoneyMutation,
      addPromotionCode: isAllowSpendMoneyMutation,
      // serviceSubscription: isAllowSpendMoneyMutation,
      buyPromotionCode: isAllowSpendMoneyMutation,
      updateInsurance: isAllowNormalMutation,
      fakeOrder: and(rules.isAuthenticatedUser, rules.isAdmin),
      fakeDeposit: and(rules.isAuthenticatedUser, rules.isAdmin),
      fakeWithdraw: and(rules.isAuthenticatedUser, rules.isAdmin),
    },
    Subscription: {
      orderResultSubscription: isAuthAndHealthy,
      lastRoundResult: isAuthAndHealthy,
      noticeRoundWinner: isAllowNormalMutation,
      adminRoundTracking: and(rules.isAuthenticatedUser, rules.isAdmin),
      adminRoundRequestSubscription: and(rules.isAuthenticatedUser, rules.isAdmin),
      adminPoolInfo: and(rules.isAuthenticatedUser, rules.isAdmin),
    },
  },
  {
    allowExternalErrors: true,
    // @ts-ignore
    fallbackError: (thrownThing, parent, args, context, info) => {
      if (
        thrownThing instanceof ApolloError ||
        // @ts-ignore
        thrownThing?.name === 'PayloadTooLargeError'
      ) {
        // expected errors
        return thrownThing
      } else if (thrownThing instanceof Error) {
        // unexpected errors
        console.error(thrownThing)
        Sentry.captureException(thrownThing)
        return new ApolloError(
          'Internal server error',
          { message: 'ERR_INTERNAL_SERVER' },
          { message: 'ERR_INTERNAL_SERVER' },
        )
      } else {
        // what the hell got thrown
        console.error('The resolver threw something that is not an error.')
        console.error(thrownThing)
        return new ApolloError(
          'Internal server error',
          { message: 'ERR_INTERNAL_SERVER' },
          { message: 'ERR_INTERNAL_SERVER' },
        )
      }
    },
  },
)