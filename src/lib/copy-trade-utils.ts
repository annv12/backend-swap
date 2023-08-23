import { CopyTrade, CopyTradeActionStatus, CopyTradeStatus, Prisma, PrismaClient } from '@prisma/client'
import logger from './logger'
import math from './math'
//@ts-ignore
import { v4 as uuidv4 } from 'uuid'

export type CopyTradeCustomQuery = {
  copy_trade_id: string
  trader_id: string
  copier_id: string
  username: string
  status: CopyTradeStatus
  end_time: Date
  // end_time: string
  base_balance: number
  sum_amount: number
  total_balance: number
  wallet_id: string
  copy_amount: number
  remain: number
  percent_per_trade: number | null
  fixed_amount_per_trade: number | null
  max_amount_per_trade: number | null
  stop_loss: number | null
  take_profit: number | null
  profit_sharing: number
  is_wallet_frozen: boolean
}

type Stop = {
  type: CopyTradeActionStatus
  copyTrade: CopyTradeCustomQuery
}

export function validateCopyTrades(
  cps: CopyTradeCustomQuery[],
  betAmount: number,
) {
  const stopList: Stop[] = []
  const qualifiedCopytrade = cps.filter((cp) => {
    let stopValue = math.div(cp.remain, cp.copy_amount).toNumber()
    
    let betAmountCopy = 0
    // get bet amount
    if (cp.fixed_amount_per_trade != null) {
      // priority this than percent per trade
      betAmountCopy = cp.fixed_amount_per_trade
    } else if (cp.percent_per_trade != null) {
      betAmountCopy = math.mul(cp.percent_per_trade, betAmount).toNumber()
      // @ts-ignore
      if (betAmountCopy > cp.max_amount_per_trade) {
        // @ts-ignore
        betAmountCopy = cp.max_amount_per_trade
      }
    }

    let remain = math.sub(cp.remain, betAmountCopy).toNumber()
    if (cp.remain < 0 || remain < 0) {
      stopList.push({
        type: CopyTradeActionStatus.REMAIN_NOT_ENOUGHT,
        copyTrade: cp,
      })
      return false
    } else if (cp.stop_loss != null && stopValue <= cp.stop_loss) {
      stopList.push({
        type: CopyTradeActionStatus.STOP_LOSS,
        copyTrade: cp,
      })
      return false
    } else if (cp.take_profit != null && stopValue >= cp.take_profit) {
      stopList.push({
        type: CopyTradeActionStatus.TAKE_PROFIT,
        copyTrade: cp,
      })
      return false
    } else if (new Date(cp.end_time) < new Date()) {
      stopList.push({
        type: CopyTradeActionStatus.OUT_OFF_PLAN,
        copyTrade: cp,
      })
      return false
    } else if (cp.is_wallet_frozen) {
      return false
    } else if (Number(cp.total_balance) < Number(betAmountCopy)) {
      return false
    } else {
      return true
    }
  })

  return {
    qualifiedCopytrade,
    stopList,
  }
}

async function stopCopyTrade(
  copyTrade: CopyTradeCustomQuery,
  status: CopyTradeActionStatus,
  prisma: PrismaClient,
) {
  await prisma.copyTrade.update({
    data: {
      status: 'STOP',
    },
    where: {
      id: copyTrade.copy_trade_id,
    },
  })
  // log action
  await prisma.copyTradeAction.create({
    data: {
      status: status,
      amount: copyTrade.remain,
      extra_data: {
        ...(copyTrade as any),
      },
      CopyTrade: {
        connect: {
          id: copyTrade.copy_trade_id,
        },
      },
    },
  })
}

export async function stopManyCopytrade(
  copyTrades: Stop[],
  prisma: PrismaClient,
) {
  if (copyTrades.length === 0) return

  const stop = prisma.copyTrade.updateMany({
    where: {
      id: {
        in: copyTrades.map((i) => i.copyTrade.copy_trade_id),
      },
    },
    data: {
      status: 'STOP',
    },
  })

  const insertData = copyTrades.map((i) => {
    const copyTradeData: CopyTrade = {
      id: i.copyTrade.copy_trade_id,
      amount: i.copyTrade.copy_amount,
      remain: i.copyTrade.remain,
      status: 'STOP',
      copier_id: i.copyTrade.copier_id,
      createdAt: new Date(),
      stop_loss: i.copyTrade.stop_loss,
      trader_id: i.copyTrade.trader_id,
      updatedAt: new Date(),
      take_profit: i.copyTrade.take_profit,
      profit_sharing: i.copyTrade.profit_sharing,
      percent_per_trade: i.copyTrade.percent_per_trade,
      max_amount_per_trade: i.copyTrade.max_amount_per_trade,
      fixed_amount_per_trade: i.copyTrade.fixed_amount_per_trade,
    }

    const jsonData = JSON.stringify(copyTradeData)

    return Prisma.sql`(${uuidv4()}, NOW(), ${i.type}, ${i.copyTrade.remain}, ${jsonData}, ${i.copyTrade.copy_trade_id})`
  })

  console.time('create-copytrade-action')
  const createCopyTradeAction = prisma.$queryRaw(Prisma.sql`
      INSERT INTO "copy_trade_action" (id, "updated_at", status, amount, extra_data, copy_trade_id)
      VALUES ${Prisma.join(insertData)}
    `)
  console.timeEnd('create-copytrade-action')

  const result = await prisma.$transaction([stop, createCopyTradeAction])
  return result
}
