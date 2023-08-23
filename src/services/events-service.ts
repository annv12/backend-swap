import redis from 'redis'
import { RedisChannel } from '../lib/redis-utils'
import { Order, PrismaClient, OrderResult } from '@prisma/client'
import logger from '../lib/logger'
require('dotenv').config()

const prisma = new PrismaClient()

const subscriber = redis.createClient({
  host: process.env.NODE_ENV === 'production' ? 'redis' : 'localhost',
})

subscriber.subscribe(RedisChannel.EVENT_ORDER_RESULT)

async function main() {
  const tourName = process.env.TOURNAMENT_NAME || 'second'

  const event = await prisma.tournament.findUnique({
    where: {
      name: tourName,
    },
  })

  if (!event) return logger.error(`Cannot find tournament ${tourName}`)

  subscriber.on('message', async (channel, message) => {
    logger.info(channel, { message })
    const data = JSON.parse(message)
    logger.info('Got message -> data', data)

    if (data.createdAt < event.start_date) {
      logger.info(`Event is not open yet!`)
      return
    }

    if (data.createdAt > event.end_date) {
      logger.info(`Event ended`)
      return
    }

    if (data) {
      const pr = data.map((i: any) => {
        return updateValue(event, i)
      })
      const result = await Promise.all(pr)
      console.log('main -> result', result)
    }
  })
}

main().catch((err) => console.log(err))

async function updateValue(event: any, data: any) {
  const tourTxs = await prisma.tournamentTransaction.findMany({
    where: {
      user_id: data.user_id,
      tournament_id: event.id,
    },
  })
  logger.info(`Tournament Tx: `, tourTxs)

  const user = await prisma.user.findUnique({
    where: {
      id: data.user_id,
    },
  })
  logger.info(`User: `, user)

  const sensoredUsername = user.username
    .split('')
    .map((i, index) => {
      if ([2, 3, 4, 5].indexOf(index) >= 0) {
        return '*'
      } else {
        return i
      }
    })
    .join('')

  if (tourTxs.length === 0) {
    logger.info(`Not found record for user ${data.user_id}, create one`)
    await prisma.tournamentTransaction.create({
      data: {
        Tournament: {
          connect: {
            id: event.id,
          },
        },
        User: {
          connect: {
            id: data.user_id,
          },
        },
        value: data.count,
        extra_data: {
          username: sensoredUsername,
        },
      },
    })
  } else {
    const value = tourTxs[0].value
    logger.info(`Update tournament stats for user ${data.user_id}`, {
      tourTx: tourTxs[0],
    })
    await prisma.tournamentTransaction.update({
      where: {
        id: tourTxs[0].id,
      },
      data: {
        value: value + data.winAmount,
      },
    })
  }
}
