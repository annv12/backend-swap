import { objectType } from 'nexus'

interface ExchangeDetail {
  totalRound: number
  totalTradeAmount: number
  winRound: number
  loseRound: number
  drawRound: number
  refundRound: number
  revenue: number
  profit: number
  ref: number // ref comission
  transferIn: number
  transferOut: number
  promotionCode: number
  promotion: number
  refund: number
  agency: number
  totalIn: number
  totalOut: number
  convertIn: number
  convertOut: number
  balance: number
}
export interface ExchangeSumary {
  main: ExchangeDetail
  promotion: ExchangeDetail
  demo: ExchangeDetail
}

export const reportFollowTypePayload = objectType({
  name: 'ExchangeDetail',
  definition: (t) => {
    t.float('totalTradeAmount', { nullable: true })
    t.float('totalRound', { nullable: true })
    t.float('winRound', { nullable: true })
    t.float('loseRound', { nullable: true })
    t.float('drawRound', { nullable: true })
    t.float('refundRound', { nullable: true })
    t.float('revenue', { nullable: true })
    t.float('profit', { nullable: true })
    t.float('ref', { nullable: true })
    t.float('transferIn', { nullable: true })
    t.float('transferOut', { nullable: true })
    t.float('promotionCode', { nullable: true })
    t.float('promotion', { nullable: true })
    t.float('refund', { nullable: true })
    t.float('agency', { nullable: true })
    t.float('totalIn', { nullable: true })
    t.float('totalOut', { nullable: true })
    t.float('convertIn', { nullable: true })
    t.float('convertOut', { nullable: true })
    t.float('balance', { nullable: true })
  },
})

export const exchangeWalletSumary = objectType({
  name: 'ExchangeWalletSumary',
  definition: (t) => {
    t.float('bet', { nullable: true })
    t.float('win', { nullable: true })
    t.float('ref', { nullable: true })
    t.float('transferIn', { nullable: true })
    t.float('transferOut', { nullable: true })
    t.float('promotionCode', { nullable: true })
    t.float('promotion', { nullable: true })
    t.float('refund', { nullable: true })
    t.float('agency', { nullable: true })
    t.float('totalIn', { nullable: true })
    t.float('totalOut', { nullable: true })
    t.float('convertIn', { nullable: true })
    t.float('convertOut', { nullable: true })
    t.float('balance', { nullable: true })
    t.float('manualIn', { nullable: true })
  },
})
