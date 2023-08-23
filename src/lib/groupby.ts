// @ts-nocheck
import { Order, OrderResult } from '@prisma/client'

export default function groupBy(xs: any, key: any) {
  return xs.reduce(function (rv: any, x: any) {
    ;(rv[x[key]] = rv[x[key]] || []).push(x)
    return rv
  }, {})
}

export function groupOrder(orders: OrderResult[]) {
  function groupResult(grouped: any[]) {
    Object.keys(grouped).forEach((i) => {
      const winAmount = grouped[i].reduce((acc, curr) => {
        return acc + (curr.win_amount - curr.bet_amount)
      }, 0)

      grouped[i] = {
        count: grouped[i].length,
        winAmount,
        user_id: i,
        createdAt: new Date(),
      }
    })
    return grouped
  }

  const gg = groupBy(orders, 'user_id')

  const result = groupResult(gg)
  return result
}
