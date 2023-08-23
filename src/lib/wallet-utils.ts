import { Prisma, PrismaClient } from '@prisma/client'

export async function getSpendableBalance(
  userId: string,
  prisma: PrismaClient,
) {
  const data = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT exchange_wallet.id,
      exchange_wallet.base_balance,
      sum_wlc.sum as balance
    FROM exchange_wallet
    LEFT JOIN
    (SELECT sum(amount) AS SUM,
        exchange_wallet_id
    FROM exchange_wallet_change
    GROUP BY exchange_wallet_change.exchange_wallet_id) AS sum_wlc ON sum_wlc.exchange_wallet_id = exchange_wallet.id
    WHERE exchange_wallet.user_id = ${userId}
    AND exchange_wallet.type = 'MAIN'
  `)

  // console.log(data[0])
  return Number(data[0].balance)
}
