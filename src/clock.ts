import { format } from 'date-fns'
import logger from './lib/logger'
import Redis from 'ioredis'
import { getTimeID } from './lib/round-utils'

require('dotenv').config()

const redisHost = process.env.NODE_ENV === 'production' ? 'redis' : '127.0.0.1'

const options = {
  host: redisHost,
  port: 6379,
  retryStrategy: (times: number) => {
    // reconnect after
    return Math.min(times * 50, 2000)
  },
}

const publisher = new Redis(options)

async function run(
  second: number,
  cd: number,
  isEnable: boolean,
  roundId: number,
) {
  const countDown =
    second >= 30 ? 30 - Math.abs(30 - second) : Math.abs(30 - second)

  logger.info(
    `Count down: ${countDown} - isEnable: ${isEnable} - second: ${second} - round: ${getTimeID(
      new Date().getTime(),
    )}`,
  )

  // if (countDown === 1) {
  //   if (!isEnable) {
  //     logger.info(' [x] Open Round')
  //     channel.publish(EXCHANGE_NAME, 'open-round', Buffer.from('1'))
  //   }
  // }

  if (countDown === 30) {
    if (!isEnable) {
      logger.info('🚀 Send lock-round signal')
      publisher.publish('lock-round', (roundId - 1).toString())
    } else {
      logger.info('🚀 Send close-round signal')
      publisher.publish('close-round', (roundId - 1).toString())
      logger.info('🚀 Send open-round signal')
    }
  }

  const clockDataString = JSON.stringify({
    countDown: countDown,
    enable: isEnable,
    roundId: roundId,
  })

  publisher.publish('clock-machine', clockDataString)

  // const candleStickData = {
  //   open: '0',
  //   close: '0',
  //   high: '0',
  //   low: '0',
  //   f: '0',
  //   date: new Date().getTime(),
  //   countDown: countDown,
  // }
  // publisher.publish('candlestick', JSON.stringify(candleStickData))

  if (countDown === 1) {
    // publisher.publish(
    //   'last-candlestick',
    //   JSON.stringify({
    //     ...candleStickData,
    //     type:
    //       Number(candleStickData.close) > Number(candleStickData.open)
    //         ? 'UP'
    //         : 'DOWN',
    //   }),
    // )
  }
}

async function main() {
  let memSecond = 0
  let count = 30
  let memEnable = false
  const t = parseInt(process.env.ROOT_TIME)

  logger.info(` [*] Root time: ${new Date(t)}, ${t}`)
  logger.info(` [*] Current time: ${new Date()}`)

  setInterval(() => {
    const second = new Date().getSeconds()

    if (memSecond !== second) {
      const t2 = Math.floor(Date.now() / 1000)
      const t3 = t2 - t

      const isEnable = !Boolean(Math.floor(t3 / 30) % 2)
      // const isEnable = second < 30

      // const countDown = 30 - (second % 30)

      if (memEnable !== isEnable) {
        memEnable = isEnable
        count = 30
      }

      const roundId = getTimeID(new Date().getTime())
      run(second, count, Boolean(isEnable), roundId)

      memSecond = second
      count--
    }
  }, 1000)
}

main()
