export enum RedisChannel {
  EVENT_ORDER = 'event-order',
  EVENT_ORDER_RESULT = 'event-order-result',
  CLOCK_MACHINE_TICK = 'clock-machine',
}

export enum RedisDatabaseKey {
  ROUND_DECISION = 'round-decision',
  TRADE_MODE = 'trade_mode',
}

const redisHost = process.env.NODE_ENV === 'production' ? 'redis' : '127.0.0.1'
export const redisOptions = {
  host: redisHost,
  port: 6379,
  retryStrategy: (times: number) => {
    // reconnect after
    return Math.min(times * 50, 2000)
  },
}
