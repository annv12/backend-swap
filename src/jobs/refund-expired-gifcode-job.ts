import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  // log: ['query', 'info', 'warn'],
})

export async function refundExpiredPromotionCodeJob() {
  const now = new Date()
  const promotionCodeExpired = await prisma.promotionCode.findMany({
    where: {
      buy_promotion_code_transaction_id: {
        not: null,
      },
      expiration_date: {
        lt: now,
      },
      PromotionCodeTransaction: {
        none: {
          type: { in: ['APPLY', 'REFUND_BUY_EXPIRE'] },
        },
      },
    },
    include: {
      BuyPromotionCodeTransaction: true,
    },
  })

  for (const promoCode of promotionCodeExpired) {
    const userOwnPromoCode = await prisma.user.findUnique({
      where: { id: promoCode.BuyPromotionCodeTransaction.user_id },
      include: {
        ExchangeWallet: true,
      },
    })

    const userWallet = userOwnPromoCode.ExchangeWallet.find(
      (i) => i.type === 'MAIN',
    )

    const promoCodeTx = await prisma.promotionCodeTransaction.create({
      data: {
        type: 'REFUND_BUY_EXPIRE',
        User: {
          connect: {
            id: promoCode.BuyPromotionCodeTransaction.user_id,
          },
        },
        PromotionCode: {
          connect: {
            id: promoCode.id,
          },
        },
      },
    })

    const walletChange = await prisma.exchangeWalletChange.create({
      data: {
        ExchangeWallet: {
          connect: { id: userWallet.id },
        },
        amount: promoCode.amount,
        event_id: promoCodeTx.id,
        event_type: 'PROMOTION_CODE_REFUND',
      },
    })
  }
}

// refundExpiredPromotionCodeJob()
//   .catch((err) => console.log(err))
//   .finally(() => process.exit())
