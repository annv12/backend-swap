// import { LeaderBoard, Order, PrismaClient, User } from '@prisma/client'
// import * as R from 'ramda'
// import { getCommissionFromUser, getREFNetwork } from '../lib/ref-utils'
// import math from '../lib/math'
// import { getMainWalletBalance, getExchangeWalletBalance } from '../utils'
// import logger from '../lib/logger'

// const prisma = new PrismaClient()

// const sensorUsername = (username: string) =>
//   username
//     .split('')
//     .map((i, index) => {
//       if ([2, 3, 4, 5].indexOf(index) >= 0) {
//         return '*'
//       } else {
//         return i
//       }
//     })
//     .join('')

// export async function updateLeaderBoard(isIgnoreCache = false) {
//   const newCachetime = new Date()
//   const users = await prisma.user.findMany({
//     select: {
//       id: true,
//       username: true,
//     },
//   })
//   console.log('updateLeaderBoard -> usersCount', users.length)

//   for (let user of users) {
//     const history = isIgnoreCache
//       ? ({} as LeaderBoard)
//       : await prisma.leaderBoard.findUnique({
//           where: { user_id: user.id },
//         })

//     const cacheTime = isIgnoreCache ? undefined : history?.cache_time

//     const {
//       order_count = 0,
//       win_count = 0,
//       lose_count = 0,
//       win_amount = 0,
//       lose_amount = 0,
//       trade_amount = 0,
//       commission = 0,
//     } = history ?? {}

//     const userExchangeWallets = await prisma.exchangeWallet.findMany({
//       where: {
//         user_id: user.id,
//       },
//     })
//     const userLiveWallet = userExchangeWallets.find((i) => i.type === 'MAIN')

//     // if no live wallet, it means demo account so we do nothing
//     if (!userLiveWallet) {
//       console.warn('DEMO ACCOUNT', user.username)
//       continue
//     }

//     const totalOrdersCount = await prisma.order.count({
//       where: {
//         user_id: user.id,
//         createdAt: {
//           gt: cacheTime,
//         },
//         account_type: 'MAIN',
//       },
//     })

//     const winOrderCount = await prisma.order.count({
//       where: {
//         user_id: user.id,
//         createdAt: {
//           gt: cacheTime,
//         },
//         account_type: 'MAIN',
//         OrderResult: {
//           status: 'WIN',
//         },
//       },
//     })

//     const loseOrderCount = await prisma.order.count({
//       where: {
//         user_id: user.id,
//         createdAt: {
//           gt: cacheTime,
//         },
//         account_type: 'MAIN',
//         OrderResult: {
//           status: 'LOSE',
//         },
//       },
//     })

//     const tradeQTY = await prisma.order.aggregate({
//       where: {
//         user_id: user.id,
//         createdAt: {
//           gt: cacheTime,
//         },
//         account_type: 'MAIN',
//       },
//       _sum: {
//         bet_amount: true,
//       },
//     })
//     const tradeAmount = tradeQTY._sum.bet_amount ?? 0

//     const loseQTY = await prisma.order.aggregate({
//       where: {
//         user_id: user.id,
//         createdAt: {
//           gt: cacheTime,
//         },
//         account_type: 'MAIN',
//         OrderResult: {
//           status: 'LOSE',
//         },
//       },
//       _sum: {
//         bet_amount: true,
//       },
//     })
//     const loseAmount = loseQTY._sum.bet_amount ?? 0

//     const ref_txs = await prisma.refTransaction.aggregate({
//       where: {
//         sponsor_id: user.id,
//       },
//       _sum: {
//         earned: true,
//       },
//     })

//     const totalCommission = ref_txs._sum.earned ?? 0

//     let win_rate =
//       ((win_count + winOrderCount) / (order_count + totalOrdersCount)) * 100
//     if (isNaN(win_rate)) win_rate = 0

//     const orderResults = await prisma.exchangeWalletChange.aggregate({
//       where: {
//         event_type: 'ORDER_RESULT',
//         exchange_wallet_id: userLiveWallet.id,
//         amount: {
//           gt: 0,
//         },
//         createdAt: {
//           gt: cacheTime,
//         },
//         ExchangeWallet: {
//           id: userLiveWallet.id,
//         },
//       },
//       _sum: {
//         amount: true,
//       },
//     })
//     const totalRevenue = orderResults._sum.amount ?? 0

//     const net_profit = totalRevenue - tradeAmount

//     const mainWallets = await prisma.mainWallet.findMany({
//       where: {
//         user_id: user.id,
//       },
//       include: {
//         Currency: {
//           select: {
//             id: true,
//             name: true,
//           },
//         },
//       },
//     })

//     const mainWalletWithbalance = mainWallets.map(async (wallet) => {
//       const balance = await getMainWalletBalance(wallet, prisma)
//       return {
//         balance,
//         cuerrency: wallet.Currency,
//       }
//     })

//     const mainWalletData = await Promise.all(mainWalletWithbalance)

//     const exchangeWallets = await prisma.exchangeWallet.findMany({
//       where: {
//         user_id: user.id,
//       },
//     })
//     const exchangeWalletsWithBalance = exchangeWallets.map(async (i) => {
//       const balance = await getExchangeWalletBalance(i, prisma)
//       return {
//         balance,
//         type: i.type,
//       }
//     })

//     const exChangeWalletData = await Promise.all(exchangeWalletsWithBalance)

//     const mainTxs = await prisma.mainWalletTransaction.findMany({
//       where: {
//         user_id: user.id,
//       },
//       include: {
//         Currency: true,
//       },
//     })

//     const txByWallet = mainWallets.map((wallet) => {
//       const currency = wallet.Currency
//       const deposit = mainTxs.filter(
//         (i) => i.tx_type === 'DEPOSIT' && i.Currency.id === currency.id,
//       )
//       const depositAmount = deposit.reduce((acc, curr) => {
//         return math.add(acc, curr.amount).toNumber()
//       }, 0)

//       const withdraw = mainTxs.filter(
//         (i) =>
//           i.tx_type === 'WITHDRAW' &&
//           i.Currency.id === currency.id &&
//           i.status === 'SUCCEED',
//       )

//       const withdrawAmount = withdraw.reduce((acc, curr) => {
//         return math.add(acc, curr.amount).toNumber()
//       }, 0)

//       return {
//         wallet_id: wallet.id,
//         currencyName: currency.name,
//         depositCount: deposit.length,
//         depositAmount,
//         withdrawCount: withdraw.length,
//         withdrawAmount,
//       }
//     })

//     const transfers = await prisma.internalTransaction.findMany({
//       where: {
//         user_id: user.id,
//       },
//     })
//     const totalSentUSD = transfers
//       .filter((i) => i.tx_type === 'SEND')
//       .reduce((acc, curr) => {
//         return math.add(acc, curr.amount).toNumber()
//       }, 0)
//     const totalReceiveUSD = transfers
//       .filter((i) => i.tx_type === 'RECEIVE')
//       .reduce((acc, curr) => {
//         return math.add(acc, curr.amount).toNumber()
//       }, 0)

//     const transferData = {
//       totalSentUSD,
//       totalReceiveUSD,
//     }

//     const refs = await prisma.ref.findMany({ where: { sponsor_id: user.id } })

//     const refsData = await getREFNetwork(user.id, 7, prisma)
//     const refNetworkVolumeAg = await prisma.order.aggregate({
//       where: {
//         user_id: {
//           in: refsData.map((i) => i.user_id),
//         },
//         account_type: 'MAIN',
//         createdAt: {
//           gt: cacheTime,
//         },
//       },
//       _sum: {
//         bet_amount: true,
//       },
//     })
//     const refNetworkRingVolumeAg = await prisma.ringOrder.aggregate({
//       where: {
//         user_id: {
//           in: refsData.map((i) => i.user_id),
//         },
//         // createdAt: {
//         //   gt: cacheTime,
//         // },
//       },
//       sum: {
//         bet_amount: true,
//       },
//     })
//     const refNetworkVolume = math
//       .add(
//         refNetworkVolumeAg._sum.bet_amount ?? 0,
//         refNetworkRingVolumeAg.sum.bet_amount ?? 0,
//       )
//       .toNumber()

//     const userIds = refs.map((r) => r.user_id)
//     const f1TradeVolumn = await prisma.order.aggregate({
//       where: {
//         user_id: {
//           in: userIds,
//         },
//         account_type: 'MAIN',
//       },
//       _sum: {
//         bet_amount: true,
//       },
//     })

//     const f1RingVolumn = await prisma.ringOrder.aggregate({
//       where: {
//         user_id: {
//           in: userIds,
//         },
//       },
//       _sum: {
//         bet_amount: true,
//       },
//     })

//     const data = {
//       sensored_username: sensorUsername(user.username),
//       order_count: order_count + totalOrdersCount,
//       win_count: win_count + winOrderCount,
//       lose_count: lose_count + loseOrderCount,
//       win_rate,
//       net_profit,
//       trade_amount: trade_amount + tradeAmount,
//       win_amount: win_amount + totalRevenue,
//       lose_amount: lose_amount + loseAmount,
//       commission: totalCommission,
//       main_wallets: mainWalletData,
//       exchange_wallets: exChangeWalletData,
//       tx_by_wallet: txByWallet,
//       transfer: transferData,
//       ref_count: refsData.length,
//       f1_count: refs.length,
//       f1_volume: math
//         .add(
//           f1TradeVolumn._sum.bet_amount ?? 0,
//           f1RingVolumn._sum.bet_amount ?? 0,
//         )
//         .toNumber(),
//       cache_time: newCachetime,
//       ref_network_volume: refNetworkVolume,
//     }

//     const result = await prisma.leaderBoard.upsert({
//       where: {
//         user_id: user.id,
//       },
//       create: { ...data, User: { connect: { id: user.id } } },
//       update: { ...data },
//     })
//     logger.info('updateLeaderBoard -> result', result)
//   }
// }

// function calculateOrderVolume(orders: Order[]) {
//   const result = orders.reduce((acc, curr) => {
//     return math.add(acc, curr.bet_amount).toNumber()
//   }, 0)

//   return result
// }

// export async function getUserStats(user: User) {
//   const orders = await prisma.order.findMany({
//     where: {
//       user_id: user.id,
//     },
//     include: {
//       OrderResult: true,
//     },
//   })

//   const totalOrdersCount = orders.length
//   const winOrder = orders
//     .filter((order) => order.OrderResult)
//     .filter(
//       (order) => order.OrderResult.is_win || order.OrderResult.status === 'WIN',
//     )
//   const loseOrder = orders
//     .filter((order) => order.OrderResult)
//     .filter(
//       (order) =>
//         !order.OrderResult.is_win || order.OrderResult.status === 'LOSE',
//     )

//   const tradeAmount = calculateOrderVolume(orders)
//   const winAmount = calculateOrderVolume(winOrder)
//   const loseAmount = calculateOrderVolume(loseOrder)

//   const userRefs = await prisma.ref.findMany({
//     where: {
//       sponsor_id: user.id,
//     },
//   })

//   const commissionPr = userRefs.map((ref) => {
//     return getCommissionFromUser(ref.sponsor_id, ref.user_id, prisma)
//   })

//   const commissionAr = await Promise.all(commissionPr)
//   const totalCommission = commissionAr.reduce((acc, curr) => {
//     return math.add(acc, curr).toNumber()
//   }, 0)

//   const win_rate = (winOrder.length / totalOrdersCount) * 100 ?? 0

//   const net_profit = winAmount - loseAmount

//   const mainWallets = await prisma.mainWallet.findMany({
//     where: {
//       user_id: user.id,
//     },
//     include: {
//       Currency: {
//         select: {
//           id: true,
//           name: true,
//         },
//       },
//     },
//   })

//   const mainWalletWithbalance = mainWallets.map(async (i) => {
//     const balance = await getMainWalletBalance(i, prisma)
//     return {
//       balance,
//       cuerrency: i.Currency,
//     }
//   })

//   const mainWalletData = await Promise.all(mainWalletWithbalance)

//   const exchangeWallets = await prisma.exchangeWallet.findMany({
//     where: {
//       user_id: user.id,
//     },
//   })
//   const exchangeWalletsWithBalance = exchangeWallets.map(async (i) => {
//     const balance = await getExchangeWalletBalance(i, prisma)
//     return {
//       balance,
//       type: i.type,
//     }
//   })

//   const exChangeWalletData = await Promise.all(exchangeWalletsWithBalance)

//   const mainTxs = await prisma.mainWalletTransaction.findMany({
//     where: {
//       user_id: user.id,
//     },
//     include: {
//       Currency: true,
//     },
//   })

//   const txByWallet = mainWallets.map((wallet) => {
//     const currency = wallet.Currency
//     const deposit = mainTxs.filter(
//       (i) => i.tx_type === 'DEPOSIT' && i.Currency.id === currency.id,
//     )
//     const depositAmount = deposit.reduce((acc, curr) => {
//       return math.add(acc, curr.amount).toNumber()
//     }, 0)

//     const withdraw = mainTxs.filter(
//       (i) =>
//         i.tx_type === 'WITHDRAW' &&
//         i.Currency.id === currency.id &&
//         i.status === 'SUCCEED',
//     )

//     const withdrawAmount = withdraw.reduce((acc, curr) => {
//       return math.add(acc, curr.amount).toNumber()
//     }, 0)

//     return {
//       wallet_id: wallet.id,
//       currencyName: currency.name,
//       depositCount: deposit.length,
//       depositAmount,
//       withdrawCount: withdraw.length,
//       withdrawAmount,
//     }
//   })

//   const transfers = await prisma.internalTransaction.findMany({
//     where: {
//       user_id: user.id,
//     },
//   })
//   const totalSentUSD = transfers
//     .filter((i) => i.tx_type === 'SEND')
//     .reduce((acc, curr) => {
//       return math.add(acc, curr.amount).toNumber()
//     }, 0)
//   const totalReceiveUSD = transfers
//     .filter((i) => i.tx_type === 'RECEIVE')
//     .reduce((acc, curr) => {
//       return math.add(acc, curr.amount).toNumber()
//     }, 0)

//   const transferData = {
//     totalSentUSD,
//     totalReceiveUSD,
//   }

//   const refs = await prisma.ref.findMany({ where: { sponsor_id: user.id } })

//   const refsData = await getREFNetwork(user.id, 7, prisma)

//   const data = {
//     user_id: user.id,
//     sensored_username: sensorUsername(user.username),
//     username: user.username,
//     email: user.email,
//     order_count: totalOrdersCount,
//     win_count: winOrder.length,
//     lose_count: loseOrder.length,
//     win_rate,
//     net_profit,
//     trade_amount: tradeAmount,
//     win_amount: winAmount,
//     lose_amount: loseAmount,
//     commission: totalCommission,
//     main_wallets: mainWalletData,
//     exchange_wallets: exChangeWalletData,
//     tx_by_wallet: txByWallet,
//     transfer: transferData,
//     ref_count: refsData.length,
//     f1_count: refs.length,
//   }

//   return data
// }
