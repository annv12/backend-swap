import fetch from 'node-fetch'
import { Order, Round, User } from '@prisma/client'
import Redis from 'ioredis'
import { RedisChannel, redisOptions } from './redis-utils'
import logger from './logger'
import { getTimeID } from './round-utils'

const publisher = new Redis(redisOptions)

type BlackBoxOrder = {
  bet_type: 'h' | 'l'
  bet_amount: number
}

export async function sendBatchOrderToBlackBox(
  orders: string[],
  channel: string = null,
) {
  const url = process.env.BLACKBOX_URL

  let body
  body = JSON.stringify({
    details: orders,
    channel,
  })

  const request = await fetch(`${url}/api/v2/in/bid/`, {
    headers: {
      token: '57Ai8eICfsQ57Ai8eICfsQ',
    },
    method: 'POST',
    body: body,
  })

  if (!request.ok) {
    const json = await request.json()
    logger.warning(`[blackbox] not in bet round `, json)
    // @ts-ignore
    throw new ValidationError({ message: json.message })
  }

  const data = await request.json()
  logger.info('Sent Order To BlackBox', data)
  return data
}

export async function sendOrderToBlackBox(
  user: User,
  order: BlackBoxOrder,
  currentTimestamp: number,
  roundTimeID: number,
  channel: string = null,
) {
  logger.info('sendOrderToBlackBox -> roundTimeID', { roundTimeID })

  const url = process.env.BLACKBOX_URL

  let body
  if (channel) {
    body = JSON.stringify({
      details: [
        `${user.id}|${user.username}|${roundTimeID}|${Math.floor(
          currentTimestamp / 1000,
        )}|${order.bet_type}|${order.bet_amount}`,
      ],
      channel,
    })
  } else {
    body = JSON.stringify({
      details: `${user.id}|${user.username}|${roundTimeID}|${Math.floor(
        currentTimestamp / 1000,
      )}|${order.bet_type}|${order.bet_amount}`,
    })
  }

  const request = await fetch(`${url}/api/v2/in/bid/`, {
    headers: {
      token: '57Ai8eICfsQ57Ai8eICfsQ',
    },
    method: 'POST',
    body: body,
  })

  if (!request.ok) {
    const json = await request.json()
    logger.warning(`[blackbox] not in bet round `, json)
    // @ts-ignore
    throw new ValidationError({ message: json.message })
  }

  const data = await request.json()
  logger.info('Sent Order To BlackBox', data)
  return data
}

export async function sendOrderToEvent(order: Order) {
  publisher.publish(RedisChannel.EVENT_ORDER, JSON.stringify(order))
}
