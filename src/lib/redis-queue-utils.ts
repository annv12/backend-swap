import RedisSMQ from 'rsmq'

export type TradeCommissionPayload = {
  userId: string
  betAmount: number
  orderId: string
}

export const SEND_ORDER_COMMISSION_QUEUE = 'sendordercommission'

export function initQueue(rsmq: RedisSMQ) {
  console.log('start init queue', SEND_ORDER_COMMISSION_QUEUE)

  // create a queue
  rsmq.createQueue({ qname: SEND_ORDER_COMMISSION_QUEUE }, (err) => {
    if (err) {
      // if the error is `queueExists` we can keep going as it tells us that the queue is already there
      if (err.name !== 'queueExists') {
        console.error(err)
        return
      } else {
        console.log('queue exists.. resuming..')
      }
    }
  })
}

export function sendCommissionMessage(data: string, rsmq: RedisSMQ) {
  rsmq.sendMessage(
    {
      qname: SEND_ORDER_COMMISSION_QUEUE,
      message: data,
    },
    (err) => {
      if (err) {
        console.error(err)
        return
      }

      console.log('pushed new message into queue..')
    },
  )
}
