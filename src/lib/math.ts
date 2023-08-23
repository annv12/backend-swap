import BigNumber from 'bignumber.js'

BigNumber.set({ DECIMAL_PLACES: 8, ROUNDING_MODE: BigNumber.ROUND_DOWN })

export function add(
  a: number | string | BigNumber,
  b: number | string | BigNumber,
) {
  return new BigNumber(a).plus(new BigNumber(b))
}

export function sub(
  a: number | string | BigNumber,
  b: number | string | BigNumber,
) {
  return new BigNumber(a).minus(new BigNumber(b))
}

export function mul(
  a: number | string | BigNumber,
  b: number | string | BigNumber,
) {
  return new BigNumber(a).multipliedBy(new BigNumber(b))
}

export function div(
  a: number | string | BigNumber,
  b: number | string | BigNumber,
) {
  return new BigNumber(a).dividedBy(new BigNumber(b))
}

export function addMultiples(values: number[]) {
  return values.reduce((result, cur) => {
    return new BigNumber(result).plus(new BigNumber(cur ?? 0)).toNumber()
  }, 0)
}

export default { add, sub, mul, div, addMultiples }
