import { Prisma, PrismaClient } from '@prisma/client'
import { addDays, format } from 'date-fns'
import { getExchangeWalletBalance } from '../utils'
import logger from '../lib/logger'

export async function sendCopyTradeCommission(prisma: PrismaClient) {
  let copytradeCommissions = await prisma.copyTradeCommission.findMany({
    where: {
      send_to: {
        equals: null,
      },
    },
  })

  // check profit of copier
  let copierProfitMap = new Map<string, number>()
  let copierInvestedMap = new Map<string, number>()
  let startTime = new Date()
  startTime.setDate(startTime.getDate() - 1)
  startTime.setHours(0)
  startTime.setMinutes(0)
  startTime.setSeconds(0)
  let endTime = new Date()
  // endTime.setDate(endTime.getDate() - 1)
  // endTime.setHours(23)
  // endTime.setMinutes(59)
  // endTime.setSeconds(59)
  const saveTime = format(startTime, 'yyyy-MM-dd')
  // update total order for old history

  if (copytradeCommissions && copytradeCommissions.length > 0) {
    for (let item of copytradeCommissions) {
      let copierIdKey = '' + item.copier_id

      let profit: number = copierProfitMap.get(copierIdKey)
      let invested: number = copierInvestedMap.get(copierIdKey) ?? 0
      let revenue = 0

      if (profit == null) {
        // get profit
        const results = await Promise.all([
          prisma.order.aggregate({
            where: {
              copy_trade_id: item.copy_trade_id,
              createdAt: {
                gte: startTime,
                lt: endTime,
              },
            },
            _sum: {
              bet_amount: true,
            },
          }),
          prisma.orderResult.aggregate({
            where: {
              Order: {
                CopyTrade: {
                  id: item.copy_trade_id,
                },
                createdAt: {
                  gte: startTime,
                  lt: endTime,
                },
              },
            },
            _sum: {
              win_amount: true,
            },
          }),
        ])
        invested = results[0]._sum.bet_amount
        revenue = results[1]._sum.win_amount
        profit = revenue - invested
        copierProfitMap.set(copierIdKey, profit)
        copierInvestedMap.set(copierIdKey, invested)
      }
      if (profit == null) {
        continue
      }
      if (profit > 0) {
        // send commisstion to expert
        let expertWallets = await prisma.exchangeWallet.findMany({
          where: {
            user_id: item.leader_id,
            type: 'MAIN',
          },
        })
        const leaderWallet = expertWallets[0]
        const exWalletChange = await prisma.exchangeWalletChange.create({
          data: {
            amount: item.amount,
            event_type: 'COPY_TRADE_COMISSION',
            event_id: item.id,
            ExchangeWallet: {
              connect: {
                id: leaderWallet.id,
              },
            },
          },
        })
        logger.info(
          `Send commission copy trade to ${leaderWallet.type} wallet`,
          exWalletChange,
        )
      } else if (profit <= 0) {
        // send back money to copier
        let copierWallets = await prisma.exchangeWallet.findMany({
          where: {
            user_id: item.copier_id,
            type: 'MAIN',
          },
        })
        const copierWallet = copierWallets[0]
        const exWalletChange = await prisma.exchangeWalletChange.create({
          data: {
            amount: item.amount,
            event_type: 'COPY_TRADE_COMISSION_BACK',
            event_id: item.id,
            ExchangeWallet: {
              connect: {
                id: copierWallet.id,
              },
            },
          },
        })
        logger.info(
          `Send back commission copy trade of copier to ${copierWallet.type} wallet`,
          exWalletChange,
        )
      }
      // update commission is checked to ignore check on next job

      await prisma.copyTradeCommission.update({
        where: {
          id: item.id,
        },
        data: {
          send_to: profit <= 0 ? 'BACK_TO_COPIER' : 'TO_EXPERT',
        },
      })
      if (profit > 0) {
        // update commission history

        //   let totalOrderCopy = await prisma.$queryRaw`
        // select COUNT(*)
        // FROM "Order", "CopyTrade"
        // WHERE "Order".copy_trade_id = "CopyTrade".id
        // AND copy_trade_id=${item.copy_trade_id}
        // AND "Order"."createdAt" >= ${startTime}
        // AND "Order"."createdAt" <= ${endTime}
        // `

        const existDatas = await prisma.copyTradeCommissionHistory.findMany({
          where: {
            copier_id: item.copier_id,
            expert_id: item.leader_id,
            time: saveTime,
          },
        })
        // console.log('existDatas: ', existDatas)
        if (existDatas && existDatas.length > 0) {
          // update
          await prisma.copyTradeCommissionHistory.update({
            where: {
              id: existDatas[0].id,
            },
            data: {
              // total_order: parseInt(totalOrderCopy[0].count ?? 0),
              total_order: 0,
              win_order: {
                increment: 1,
              },
              volume: invested,
              profit: profit,
              commission: {
                increment: item.amount,
              },
            },
          })
        } else {
          await prisma.copyTradeCommissionHistory.create({
            data: {
              User: {
                connect: {
                  id: item.copier_id,
                },
              },
              expert_id: item.leader_id,
              time: saveTime,
              // total_order: parseInt(totalOrderCopy[0].count ?? 0),
              total_order: 0,
              win_order: 1,
              volume: invested,
              profit: profit,
              commission: item.amount,
            },
          })
        }
      }
    }
  }

  // update total order for all case, exp trade lost so not exist commision but need update total order
  const commisstionHistories = await prisma.copyTradeCommissionHistory.findMany(
    {
      where: {
        time: saveTime,
      },
    },
  )
  if (commisstionHistories && commisstionHistories.length > 0) {
    for (let item of commisstionHistories) {
      let totalOrderCopy = await prisma.$queryRaw<any>(Prisma.sql`
      select COUNT(*)
      FROM "order", "copy_trade"
      WHERE "order".copy_trade_id = "copy_trade".id
      AND copier_id=${item.copier_id} AND trader_id=${item.expert_id}
      AND "order"."created_at" >= ${startTime}
      AND "Order"."created_at" <= ${endTime}
      `)

      await prisma.copyTradeCommissionHistory.update({
        where: {
          id: item.id,
        },
        data: {
          total_order: parseInt(totalOrderCopy[0].count ?? 0),
        },
      })
    }
  }
}

// export async function renewServiceSubscription() {
//   const subscriptions = await prisma.serviceSubscription.findMany({
//     where: {
//       status: 'ACTIVE',
//       end_time: {
//         lte: new Date(),
//       },
//     },
//   })
//   if (!subscriptions || subscriptions.length === 0) {
//     return
//   }
//   let prmArray: Promise<void>[] = []
//   for (let item of subscriptions) {
//     prmArray.push(handleRenew(item))
//   }
//   await Promise.all(prmArray)
// }

// async function handleRenew(item: ServiceSubscription) {
//   try {
//     const userWallets = await prisma.exchangeWallet.findMany({
//       where: {
//         user_id: item.user_id,
//         type: 'MAIN',
//       },
//     })

//     const userMainWallet = userWallets[0]
//     const userMainWalletBalance = await getExchangeWalletBalance(
//       userMainWallet,
//       prisma,
//     )

//     const plan = await prisma.plan.findUnique({ where: { id: item.plan_id } })

//     if (!plan) {
//       logger.error(
//         `Renew service subscription ${item.id} error: Plan not found`,
//       )
//       return
//     }

//     const subscriptionAmount =
//       item.duration === 'MONTHLY'
//         ? plan.price_per_month
//         : item.duration === 'QUARTER'
//         ? plan.price_per_quarter
//         : item.duration === 'HALF_YEAR'
//         ? plan.price_half_year
//         : plan.price_per_year

//     if (userMainWalletBalance < subscriptionAmount) {
//       logger.error(
//         `Renew service subscription ${item.id} error: Balance not enough`,
//       )
//       return
//     }

//     const daysAddMore =
//       item.duration === 'MONTHLY'
//         ? 30
//         : item.duration === 'QUARTER'
//         ? 120
//         : item.duration === 'HALF_YEAR'
//         ? 180
//         : 365

//     let dayExpire = addDays(new Date(), daysAddMore)

//     await prisma.serviceSubscription.update({
//       where: { id: item.id },
//       data: {
//         Plan: {
//           connect: {
//             id: plan.id,
//           },
//         },
//         status: 'ACTIVE',
//         start_time: new Date(),
//         end_time: dayExpire,
//       },
//     })

//     const tx = await prisma.subscriptionTransaction.create({
//       data: {
//         Subscription: {
//           connect: { id: item.id },
//         },
//         User: { connect: { id: item.id } },
//         amount: subscriptionAmount,
//       },
//     })

//     await prisma.exchangeWalletChange.create({
//       data: {
//         ExchangeWallet: { connect: { id: userMainWallet.id } },
//         amount: -subscriptionAmount,
//         event_id: tx.id,
//         event_type: 'SERVICE_SUBSCRIPTION',
//       },
//     })
//     logger.info(`Renew service subscription ${item.id} success`)
//   } catch (err) {
//     logger.error(`Renew service subscription ${item.id} err: ${err}`)
//   }
// }
