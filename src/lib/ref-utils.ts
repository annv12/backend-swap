import { PrismaClient } from '@prisma/client'
import math from './math'
import { startOfWeek, endOfWeek, subDays, format } from 'date-fns'
import { zonedTimeToUtc } from 'date-fns-tz'
import { RefNote } from '../types'

export async function getCommissionFromUser(
  sponsor_id: string,
  user_id: string,
  prisma: PrismaClient,
) {
  const ref_txs = await prisma.refTransaction.aggregate({
    where: {
      user_id: user_id,
      sponsor_id: sponsor_id,
    },
    _sum: {
      earned: true,
    },
  })

  const total_com = ref_txs._sum.earned ?? 0

  return total_com
}

export async function getF1TradingVolume(
  sponsor_id: string,
  isKeepRefLevel: boolean,
  prisma: PrismaClient,
) {
  if (isKeepRefLevel) {
    const ref_txs = await prisma.refTransaction.findMany({
      where: {
        sponsor_id: sponsor_id,
        RefLevel: {
          level: 1,
        },
        event_type: 'TRADING',
      },
    })
    const totalVolume = ref_txs.reduce((acc, curr) => {
      return math.add(acc, curr.amount).toNumber()
    }, 0)

    return totalVolume
  } else {
    const date = new Date().getTime()
    const startOfTheWeek = startOfWeek(date, {
      weekStartsOn: 1,
    })
    const endOfTheWeek = endOfWeek(date, {
      weekStartsOn: 1,
    })
    let startOfTheWeekTZ = zonedTimeToUtc(startOfTheWeek, 'Asia/Singapore', {
      weekStartsOn: 1,
    })
    let endOfTheWeekTZ = zonedTimeToUtc(endOfTheWeek, 'Asia/Singapore', {
      weekStartsOn: 1,
    })
    console.log(
      'functiongetF1Volume -> startOfTheWeekTZ',
      format(startOfTheWeekTZ, 'dd/MM/yyyy'),
      format(endOfTheWeekTZ, 'dd/MM/yyyy'),
    )
    const ref_txs = await prisma.refTransaction.findMany({
      where: {
        sponsor_id: sponsor_id,
        RefLevel: {
          level: 1,
        },
        event_type: 'TRADING',
        AND: [
          {
            createdAt: {
              gte: subDays(startOfTheWeekTZ, 7),
            },
          },
          {
            createdAt: {
              lte: subDays(endOfTheWeekTZ, 7),
            },
          },
        ],
      },
    })
    const totalVolume = ref_txs.reduce((acc, curr) => {
      return math.add(acc, curr.amount).toNumber()
    }, 0)

    return totalVolume
  }
}

export async function getF1Volume(
  f1s: string[],
  isKeepRefLevel: boolean,
  getThisWeekVolume: boolean = false,
  prisma: PrismaClient,
) {
  if (isKeepRefLevel) {
    const result = await prisma.order.aggregate({
      where: {
        account_type: 'MAIN',
        user_id: {
          in: f1s,
        },
      },
      _sum: {
        bet_amount: true,
      },
    })

    const volume = result._sum.bet_amount ?? 0

    return volume
  } else {
    const date = new Date().getTime()
    const startOfTheWeek = startOfWeek(date, {
      weekStartsOn: 1,
    })
    const endOfTheWeek = endOfWeek(date, {
      weekStartsOn: 1,
    })
    let startOfTheWeekTZ = zonedTimeToUtc(startOfTheWeek, 'Asia/Singapore', {
      weekStartsOn: 1,
    })
    let endOfTheWeekTZ = zonedTimeToUtc(endOfTheWeek, 'Asia/Singapore', {
      weekStartsOn: 1,
    })

    const result = await prisma.order.aggregate({
      where: {
        account_type: 'MAIN',
        user_id: {
          in: f1s,
        },
        AND: [
          {
            createdAt: {
              gte: subDays(startOfTheWeekTZ, getThisWeekVolume ? 0 : 7),
            },
          },
          {
            createdAt: {
              lte: subDays(endOfTheWeekTZ, getThisWeekVolume ? 0 : 7),
            },
          },
        ],
      },
      _sum: {
        bet_amount: true,
      },
    })

    const volume = result._sum.bet_amount ?? 0

    return volume
  }
}

export async function getRefLevelOfUser(
  sponsor_id: string,
  user_id: string,
  prisma: PrismaClient,
) {
  const refs = await prisma.ref.findMany({
    where: {
      user_id: user_id,
    },
  })
  const ref = refs[0]
  if (!ref) return 0

  if (ref.sponsor_id === sponsor_id) return 1
  const notes = ref.note as RefNote[]

  const note = notes.find((i) => i.sponsor_id === sponsor_id)
  if (!note) return 0

  const ref_level = notes.indexOf(note)
  return ref_level + 2
}

export async function getRefNetworkTreeData(
  root_sponsor_id: string,
  downlines: any[],
  prisma: PrismaClient,
) {
  const chekcA = downlines.map(async (i) => {
    return {
      ...i,
      username: i.user_name,
      isAgency: i.is_agency,
      com: await getCommissionFromUser(root_sponsor_id, i.user_id, prisma),
      sponsorUsername: i.sponsor_name,
    }
  })
  console.time('getRefNetworkData')
  const res = await Promise.all(chekcA)
  console.timeEnd('getRefNetworkData')
  // console.log('getRefNetworkData -> res', res)
  // @ts-ignore
  delete res.note
  return res
}

type RefData = {
  ref_id: string
  level: number
  sponsor_id: string
  sponsor_name: string
  user_id: string
  user_name: string
  is_agency: boolean
}

export async function generateREFNote(
  sponsor_id: string,
  prisma: PrismaClient,
) {
  const refs = await prisma.ref.findMany({
    where: {
      user_id: sponsor_id,
    },
  })
  const ref = refs[0]
  let ref_note = [] as RefNote[]
  if (ref) {
    const ref_levels = await prisma.refLevel.findMany({
      orderBy: {
        level: 'asc',
      },
    })
    let user_id = ref.user_id
    for (const key in ref_levels) {
      if (Object.prototype.hasOwnProperty.call(ref_levels, key)) {
        const ref_level = ref_levels[key]
        const up_refs = await prisma.ref.findMany({
          where: {
            user_id: user_id,
          },
        })
        const up_ref = up_refs[0]

        if (!up_ref) {
          ref_note.push({
            position: ref_level.level,
            ref_id: '',
            user_id: user_id,
            sponsor_id: '',
          })
          break
        } else {
          ref_note.push({
            position: ref_level.level,
            ref_id: up_ref.id,
            user_id: up_ref.user_id,
            sponsor_id: up_ref.sponsor_id,
          })
        }
        user_id = up_ref.sponsor_id
      }
    }
  } else {
    ref_note.push({
      position: 1,
      ref_id: '',
      user_id: sponsor_id,
      sponsor_id: '',
    })
  }

  return ref_note
}

export async function getREFNetwork(
  root_sponsor_id: string,
  level: number,
  prisma: PrismaClient,
) {
  const ref_levels = await prisma.refLevel.findMany({
    orderBy: {
      level: 'asc',
    },
    take: level,
  })

  let list_sponsor_id = [] as string[]
  let tmp_list_sponsor_id = [] as string[]
  tmp_list_sponsor_id.push(root_sponsor_id)
  let ref_networks = [] as RefData[]

  for (const key in ref_levels) {
    if (Object.prototype.hasOwnProperty.call(ref_levels, key)) {
      const ref_level = ref_levels[key]

      list_sponsor_id = tmp_list_sponsor_id
      tmp_list_sponsor_id = []

      while (list_sponsor_id.length > 0) {
        const sponsor_id = list_sponsor_id.pop()
        const refs = await prisma.ref.findMany({
          where: {
            sponsor_id: sponsor_id,
          },
          include: {
            User: true,
            Sponsor: true,
          },
        })
        for (const key in refs) {
          if (Object.prototype.hasOwnProperty.call(refs, key)) {
            const ref = refs[key]
            const user = await prisma.user.findUnique({
              where: {
                id: ref.user_id,
              },
              include: {
                UserProfile: true,
              },
            })
            tmp_list_sponsor_id.push(ref.user_id)
            ref_networks.push({
              ref_id: ref.id,
              level: ref_level.level,
              sponsor_id: ref.sponsor_id,
              sponsor_name: ref.Sponsor.username,
              user_id: ref.user_id,
              user_name: user.username,
              is_agency: user.UserProfile.is_agency,
            })
          }
        }
      }
    }
  }
  return ref_networks
}
