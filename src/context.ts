import { PrismaClient, UserRole } from '@prisma/client'
import { getUserId } from './utils'
// import { PubSub } from 'graphql-yoga'
import { RedisPubSub } from 'graphql-redis-subscriptions'
import Redis from 'ioredis'
import { setLocale } from './lib/i18n-utils'
import Redlock from 'redlock'
import RedisSMQ from 'rsmq'
import { initQueue } from './lib/redis-queue-utils'

const redisHost = process.env.NODE_ENV === 'production' ? 'redis' : '127.0.0.1'

const rsmq = new RedisSMQ({ host: redisHost, port: 6379, ns: 'rsmq' })

initQueue(rsmq)

const options = {
  host: redisHost,
  port: 6379,
  retryStrategy: (times: number) => {
    // reconnect after
    return Math.min(times * 50, 2000)
  },
}

const redis = new Redis(options)

const redlock = new Redlock(
  // you should have one client for each independent redis node
  // or cluster
  // @ts-ignore
  [redis],
  {
    // the expected clock drift; for more details
    // see http://redis.io/topics/distlock
    driftFactor: 0.01, // time in ms

    // the max number of times Redlock will attempt
    // to lock a resource before erroring
    retryCount: 15,

    // the time in ms between attempts
    retryDelay: 200, // time in ms

    // the max time in ms randomly added to retries
    // to improve performance under high contention
    // see https://www.awsarchitectureblog.com/2015/03/backoff.html
    retryJitter: 200, // time in ms
  },
)
redlock.on('clientError', function (err) {
  console.error('A redis lock error has occurred:', err)
})

const prisma = new PrismaClient({
  // log: ['query'],
})

export interface Context {
  prisma: PrismaClient
  user: string
  role: UserRole
  pubsub: any
  request: any
  i18n: any
  redlock: Redlock
  rsmq?: RedisSMQ
  // locks: Map<string, MutexInterface>
  redis: Redis
}

const pubsub = new RedisPubSub({
  publisher: new Redis(options),
  subscriber: new Redis(options),
})

export function createContext(req: any): Context {
  const tokenData = getUserId(req)
  return {
    ...req,
    user: tokenData.userId,
    role: tokenData.role,
    prisma,
    pubsub,
    i18n: setLocale(req.request),
    redlock: redlock,
    rsmq,
    redis,
  }
}
