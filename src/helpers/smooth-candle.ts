import BigNumber from 'bignumber.js'
import { ExcOrder } from '../services/set-real-binance-price'

type ClockData = {
  countDown: number
  enable: boolean
  roundId: number
}

export function smoothCandleStick(
  clockData: ClockData,
  openPrice: string,
  order: ExcOrder,
) {
  let price = order.price

  if (clockData.countDown === 30) {
    // const diff = new BigNumber(order.price).minus(openPrice)
    // if (diff.isGreaterThan(0)) {
    //   price = new BigNumber(openPrice)
    //     .plus(diff.minus(diff.div(100).times(5)))
    //     .toFixed(8)
    // } else {
    //   price = new BigNumber(openPrice)
    //     .minus(diff.minus(diff.div(100).times(5)))
    //     .toFixed(8)
    // }
    price = openPrice
  }
  if (clockData.countDown === 29) {
    const diff = new BigNumber(order.price).minus(openPrice)
    if (diff.isGreaterThan(0)) {
      price = new BigNumber(openPrice)
        .plus(diff.minus(diff.div(100).times(10)))
        .toFixed(8)
    } else {
      price = new BigNumber(openPrice)
        .minus(diff.minus(diff.div(100).times(10)))
        .toFixed(8)
    }
    // price = new BigNumber(openPrice).plus(Math.random()).toFixed(8)
  }
  if (clockData.countDown === 28) {
    const diff = new BigNumber(order.price).minus(openPrice)
    if (diff.isGreaterThan(0)) {
      price = new BigNumber(price)
        .minus(diff.minus(diff.div(100).times(50)))
        .toFixed(8)
    } else {
      price = new BigNumber(price)
        .plus(diff.minus(diff.div(100).times(50)))
        .toFixed(8)
    }
  }
  if (clockData.countDown === 27) {
    const diff = new BigNumber(order.price).minus(openPrice)
    if (diff.isGreaterThan(0)) {
      price = new BigNumber(openPrice)
        .plus(diff.minus(diff.div(100).times(65)))
        .toFixed(8)
    } else {
      price = new BigNumber(openPrice)
        .minus(diff.minus(diff.div(100).times(65)))
        .toFixed(8)
    }
  }

  const result = { ...order, price: price }
  return result
}
