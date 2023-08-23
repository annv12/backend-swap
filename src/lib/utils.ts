interface OrderByQuery {
  orderByField: string
  order: string
}
export function getOrderByQuery(
  orderBy: string,
  defaultOrder: string,
): OrderByQuery {
  let orderByField = ''
  let order = ''
  let realValue = orderBy ?? defaultOrder
  if (realValue && realValue.length > 0) {
    let temp = realValue.split(' ')
    if (temp && temp.length > 1) orderByField = temp[0]
    order = temp[1]
  }
  return { orderByField, order }
}

export function formatNumber(
  number: number,
  minimumFractionDigits: number = 2,
) {
  if (typeof number === 'undefined') return '---'
  if (isNaN(number)) return '---'
  const formatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits,
    maximumFractionDigits: minimumFractionDigits,
  })
  return formatter.format(number)
}

export function validatePassword(password: string) {
  if (
    password == null ||
    password.length < 8 ||
    password.length > 32 ||
    password.indexOf(' ') >= 0
  ) {
    return false
  }
  const numRegex = new RegExp('[0-9]{1}')
  const lowerRegex = new RegExp('[a-z]{1}')
  const uperRegex = new RegExp('[A-Z]{1}')
  const symbolRegex = new RegExp('[!@#~$%^&*()+|_]{1}')
  let totalValid = 0
  if (numRegex.test(password)) {
    totalValid += 1
  }
  if (lowerRegex.test(password)) {
    totalValid += 1
  }
  if (uperRegex.test(password)) {
    totalValid += 1
  }
  if (symbolRegex.test(password)) {
    totalValid += 1
  }
  if (totalValid < 3) {
    // khong dat 3/4 dieu kien
    return false
  }
  return true
}
