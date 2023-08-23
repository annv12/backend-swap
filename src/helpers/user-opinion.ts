import Redis from 'ioredis/built/Redis'

type ClockData = {
  countDown: number
  enable: boolean
  roundId: number
}

function getRndInteger(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export async function createUserOpinion(
  clockData: ClockData,
  publisher: Redis,
  redis: Redis,
) {
  const { countDown, enable, roundId } = clockData
  const currentUserOpinion = await redis.get('user-opinion')
  let pc = Number(currentUserOpinion) || 50

  if (enable) {
    // const rn = getRndInteger(17 + (30 - countDown), 82 - (30 - countDown))
    const rn = getRndInteger(-3, 3)
    pc = pc + rn > 100 ? 99 : pc + rn < 0 ? 1 : pc + rn
    publisher.publish('user-opinion', `${pc}`)
    await redis.set('user-opinion', pc)
  } else {
    if (countDown === 1) {
      redis.set('intercept-second', `${getRndInteger(5, 25)}`)
    }
    if (countDown === 1 && clockData.enable === false) {
      publisher.publish('user-opinion', '50')
      await redis.set('user-opinion', 50)
    } else {
      publisher.publish('user-opinion', `${pc}`)
    }
  }
}
