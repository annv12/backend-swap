// import { objectType, extendType, arg } from 'nexus'
// import * as math from '../../lib/math'
// import { getUSDTCurrencyMap } from '../../lib/convert-utils'
// import { getStatistic, TransactionSumary } from '../../jobs/statistic-job'
// import { Context } from '../../context'
// import { ValidationError } from '../../lib/error-util'
// import { Permission } from '@prisma/client'
// import { checkPermissions } from '../../lib/auth-utils'

// export const Statistic = objectType({
//   name: 'Statistic',
//   definition: (t) => {
//     t.model.id()
//     t.model.createdAt()
//     t.model.updatedAt()
//     t.model.wallet()
//     t.float('deposit')
//     t.float('withdraw')
//     t.float('pendingWithdraw')
//     t.float('transactionFee')
//     t.model.convertToExchange()
//     t.model.convertToMain()
//     t.model.commission()
//     t.model.bet()
//     t.model.win()
//     t.model.exchangeBalance()
//     t.model.balance()
//   },
// })
// type WalletType = {
//   [key: string]: TransactionSumary
// }

// export const statisticQuery = extendType({
//   type: 'Query',
//   definition: (t) => {
//     t.field('statistic', {
//       type: 'Statistic',
//       args: {
//         permissions: arg({
//           type: 'Permission',
//           list: true,
//         }),
//       },
//       resolve: async (_, { permissions }, ctx) => {
//         await checkPermissions(ctx, ['CAN_VIEW_STATISTIC'])

//         let statistics = await ctx.prisma.statistic.findMany({
//           take: 1,
//         })

//         let statisticData
//         if (!statistics || statistics.length === 0) {
//           // get statistic data
//           statisticData = await getStatistic(undefined)
//           let walletData: WalletType = {}
//           for (let item of statisticData.transactions) {
//             walletData[`${item.currency_id}`] = {
//               currency_id: item.currency_id,
//               deposit: item.deposit,
//               withdraw: item.withdraw,
//               pending_withdraw: item.pending_withdraw,
//               fee: item.fee,
//             }
//           }
//           let result = await ctx.prisma.statistic.create({
//             data: {
//               wallet: walletData,
//               commission: statisticData.commission ?? 0,
//               convertToExchange: statisticData.convertToExchange ?? 0,
//               convertToMain: statisticData.convertToMain ?? 0,
//               exchangeBalance: statisticData.exchangeBalance ?? 0,
//               bet: statisticData.bet ?? 0,
//               win: statisticData.win ?? 0,
//               balance: statisticData.balance ?? 0,
//             },
//           })
//           let estimateUsd = await processData(ctx, walletData)

//           return {
//             ...result,
//             ...estimateUsd,
//           }
//         } else {
//           let statisticObj = statistics[0]
//           statisticData = await getStatistic(statisticObj.cachedAt)
//           // console.log('statisticData: ', statisticData)
//           let walletMap = statisticObj.wallet as WalletType

//           let walletData = walletMap
//           for (let item of statisticData.transactions) {
//             let oldWalletData = walletMap[`${item.currency_id}`]
//             walletData[`${item.currency_id}`] = {
//               currency_id: item.currency_id,
//               deposit: math.add(item.deposit, oldWalletData.deposit).toNumber(),
//               withdraw: math
//                 .add(item.withdraw, oldWalletData.withdraw)
//                 .toNumber(),
//               pending_withdraw: math
//                 .add(item.pending_withdraw, oldWalletData.pending_withdraw)
//                 .toNumber(),
//               fee: math.add(item.fee, oldWalletData.fee).toNumber(),
//             }
//           }
//           let result = await ctx.prisma.statistic.update({
//             data: {
//               cachedAt: new Date(),
//               wallet: walletData,
//               commission: math
//                 .add(
//                   statisticObj.commission ?? 0,
//                   statisticData.commission ?? 0,
//                 )
//                 .toNumber(),
//               convertToExchange: math
//                 .add(
//                   statisticObj.convertToExchange ?? 0,
//                   statisticData.convertToExchange ?? 0,
//                 )
//                 .toNumber(),
//               convertToMain: math
//                 .add(
//                   statisticObj.convertToMain ?? 0,
//                   statisticData.convertToMain ?? 0,
//                 )
//                 .toNumber(),
//               exchangeBalance: math
//                 .add(
//                   statisticObj.exchangeBalance ?? 0,
//                   statisticData.exchangeBalance ?? 0,
//                 )
//                 .toNumber(),
//               balance: math
//                 .add(statisticObj.balance ?? 0, statisticData.balance ?? 0)
//                 .toNumber(),
//               bet: math
//                 .add(statisticObj.bet ?? 0, statisticData.bet ?? 0)
//                 .toNumber(),
//               win: math
//                 .add(statisticObj.win ?? 0, statisticData.win ?? 0)
//                 .toNumber(),
//             },
//             where: {
//               id: statisticObj.id,
//             },
//           })
//           // console.log('result: ', result)

//           let estimateUsd = await processData(ctx, walletData)

//           return {
//             ...result,
//             ...estimateUsd,
//           }
//         }
//       },
//     })
//   },
// })

// async function processData(ctx: Context, walletMap: WalletType) {
//   let usdtMap = await getUSDTCurrencyMap(ctx.prisma)

//   let deposit = 0
//   let withdraw = 0
//   let pendingWithdraw = 0
//   let transactionFee = 0

//   for (let key in walletMap) {
//     let usdtRate = usdtMap.get(key) ?? 0

//     let estimateUsdDeposit = math
//       .mul(walletMap[key].deposit, usdtRate)
//       .toNumber()
//     let estimateUsdWithdraw = math
//       .mul(walletMap[key].withdraw, usdtRate)
//       .toNumber()
//     let estimateUsdPendingWithdraw = math
//       .mul(walletMap[key].pending_withdraw, usdtRate)
//       .toNumber()
//     let estimateUsdTransactionFee = math
//       .mul(walletMap[key].fee, usdtRate)
//       .toNumber()

//     deposit = math.add(deposit, estimateUsdDeposit).toNumber()
//     withdraw = math.add(withdraw, estimateUsdWithdraw).toNumber()
//     pendingWithdraw = math
//       .add(pendingWithdraw, estimateUsdPendingWithdraw)
//       .toNumber()
//     transactionFee = math
//       .add(transactionFee, estimateUsdTransactionFee)
//       .toNumber()
//   }

//   return {
//     deposit,
//     withdraw,
//     pendingWithdraw,
//     transactionFee,
//   }
// }
