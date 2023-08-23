import groupBy from './groupby'
import math from './math'
import { customAlphabet } from 'nanoid'
import { PrismaClient, Order, User } from '@prisma/client'
import logger from './logger'

const prisma = new PrismaClient()

const nanoid = customAlphabet('1234567890', 6)

export function groupResult(roundResults: any[]) {
  const grouped = groupBy(roundResults, 'user_id')
  const rr = Object.keys(grouped).forEach((i) => {
    grouped[i] = handleData(grouped[i], Number(i))
  })
  return grouped
}

const handleData = (data: any[], userId: number) => {
  const win = data.filter((i) => i.is_win)
  const lose = data.filter((i) => !i.is_win)

  const winAmount = win.reduce((acc, curr) => {
    return math.add(acc, curr.win_amount).toNumber()
  }, 0)

  const loseAmount = lose.reduce((acc, curr) => {
    return math.add(acc, curr.win_amount).toNumber()
  }, 0)

  const result = {
    win: {
      id: Number(nanoid()),
      createdAt: new Date(),
      win_amount: winAmount,
      is_win: true,
      count: win.length,
      user_id: userId,
    },
    lose: {
      id: Number(nanoid()),
      createdAt: new Date(),
      win_amount: 0,
      is_win: false,
      count: lose.length,
      user_id: userId,
    },
  }
  if (win.length === 0) delete result.win
  if (lose.length === 0) delete result.lose
  return result
}

async function updateRound(round: any) {
  const res = await prisma.round.update({
    where: {
      id: round.id,
    },
    data: {
      open_price: 0,
      close_price: 0,
      type: 'BALANCE',
    },
  })
  logger.info(`UPDATE round unclosed ${res.id} done`)
}

export function getTimeID(time: number) {
  const t = parseInt(process.env.ROOT_TIME) || 1590969600
  const t2 = Math.floor(time / 1000)
  const t3 = t2 - t
  const roundId = Math.floor(t3 / 30)
  return roundId
}
