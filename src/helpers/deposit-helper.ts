import {
  MainWallet,
  MainWalletAddress,
  PrismaClient,
  WalletChangeEventType,
} from '@prisma/client'
import { notifyTele } from '../lib/notify-utils'

export async function processDepositToUserMainWallet(
  recieverWalletAddress: MainWalletAddress & {
    MainWallet: MainWallet
  },
  amount: string,
  transactionHash: string,
  prisma: PrismaClient,
) {
  const usdt_tx = await prisma.mainWalletTransaction.create({
    data: {
      User: {
        connect: {
          id: recieverWalletAddress.MainWallet.user_id,
        },
      },
      Currency: {
        connect: {
          id: recieverWalletAddress.MainWallet.currency_id,
        },
      },
      amount: Number(amount),
      tx_type: 'DEPOSIT',
      tx_hash: transactionHash,
      fee: 0,
      status: 'SUCCEED',
      address: recieverWalletAddress.address,
    },
    include: {
      User: true,
      Currency: true,
    },
  })

  await prisma.mainWalletChange.create({
    data: {
      MainWallet: {
        connect: {
          id: recieverWalletAddress.MainWallet.id,
        },
      },
      event_type: WalletChangeEventType.DEPOSIT,
      event_id: usdt_tx.id,
      amount: usdt_tx.amount,
    },
  })

  await prisma.mainWalletAddress.update({
    where: {
      id: recieverWalletAddress.id,
    },
    data: {
      need_sync_balance: true,
    },
  })

  await notifyTele(
    `username [${usdt_tx.User.username}] deposit ${usdt_tx.amount} ${usdt_tx.Currency.symbol} network: ${usdt_tx.Currency.crypto_service}`,
  )
}
