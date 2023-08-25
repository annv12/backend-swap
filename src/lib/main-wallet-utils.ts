import {
  PrismaClient,
  MainWalletTransaction,
  MainWallet,
  Crypto_Service,
} from '@prisma/client'
import {
  generateAddress as generateEthereumAddress,
  // getTransactionInfo as getEthereumTransactionInfo,
} from '../eth-service'
import { getMainWalletBalance } from '../utils'
import logger from './logger'
import { sendWithdrawSucceededMail, sendWithdrawFailedMail } from './mail-utils'
import math from './math'
import { notifyTransaction } from './notify-utils'
// import { ETHCryptoData } from '../jobs/ethereum-job'
const prisma = new PrismaClient()
import fetch from 'node-fetch'

const CRYPTO_SERVICE_URL =
  process.env.NODE_ENV === 'production'
    ? 'http://service-crypto:8000'
    : 'http://localhost:8000'

export async function generateWalletAddressV2() {
  const request = await fetch(
    CRYPTO_SERVICE_URL + '/crypto-service/generate-new-address/',
    {
      method: 'GET',
    },
  )

  if (!request.ok) {
    const json = await request.json()
    logger.warning(`Generate wallet address failed`, json)
    // @ts-ignore
    throw new ValidationError({ message: json.message })
  }

  const data: { address: string } = await request.json()
  logger.info('Generate wallet address succeeded', data)
  return data
}

export async function sendWithdrawRequestToCryptoService(
  address: string,
  amount: number,
  transactionId: string,
) {
  const request = await fetch(
    CRYPTO_SERVICE_URL + '/crypto-service/withdraw/',
    {
      method: 'POST',
      body: JSON.stringify({
        address,
        amount,
        transaction_id: transactionId,
      }),
    },
  )

  if (!request.ok) {
    const json = await request.json()
    logger.warning(`Send withdraw request failed`, json)
    // @ts-ignore
    throw new ValidationError({ message: json.message })
  }

  const data: { address: string } = await request.json()
  logger.info('Send withdraw request succeeded', data)
  return data
}

export async function generateWalletAddress(
  currency_id: string,
  user_id: string,
) {
  const currency = await prisma.currency.findUnique({
    where: {
      id: currency_id,
    },
  })
  if (currency.crypto_service == Crypto_Service.BITCOIN) {
    // return generateBitcoinAddress()
    return
  }

  if (
    currency.crypto_service == Crypto_Service.ETHEREUM ||
    currency.crypto_service == Crypto_Service.BSC
  ) {
    const walletAddresses = await prisma.mainWalletAddress.findMany({
      where: {
        MainWallet: {
          user_id: user_id,
          Currency: {
            crypto_service: currency.crypto_service,
          },
        },
      },
    })
    const walletAddress = walletAddresses[0]
    if (walletAddress) {
      return {
        address: walletAddress.address,
        encrypt_data: walletAddress.encrypt_data,
      }
    } else {
      return generateEthereumAddress()
    }
  }

  if (currency.crypto_service === 'TRON') {
    const { address } = await generateWalletAddressV2()
    return { address, encrypt_data: '' }
  }
}

export async function verifyMainWallet(main_wallet: MainWallet) {
  if (!main_wallet || main_wallet.is_frozen) return false
  const user = await prisma.user.findUnique({
    where: {
      id: main_wallet.user_id,
    },
    select: {
      UserProfile: true,
    },
  })
  if (user.UserProfile.status != 'NORMAL') return false
  return true
}

export async function updateMainWalletBalanceCacheTime() {
  const main_wallets = await prisma.mainWallet.findMany()
  main_wallets.forEach(async (main_wallet) => {
    const balance = await getMainWalletBalance(main_wallet, prisma)
    await prisma.mainWallet.update({
      where: {
        id: main_wallet.id,
      },
      data: {
        base_balance: balance,
        balance_cache_datetime: new Date(),
      },
    })
    logger.info('Update Main Wallet Balance Cache Time', {
      wallet_id: main_wallet.id,
      balance: balance,
    })
  })
}

export async function updateSucceedWithdrawalTransaction(
  tx: MainWalletTransaction,
  tx_hash: string,
) {
  const succeed_tx = await prisma.mainWalletTransaction.update({
    where: {
      id: tx.id,
    },
    data: {
      tx_hash: tx_hash,
      status: 'SUCCEED',
    },
    include: {
      Currency: true,
      User: true,
    },
  })

  sendWithdrawSucceededMail(
    succeed_tx.User.email,
    succeed_tx.User.username,
    succeed_tx.Currency.symbol,
    succeed_tx.address,
    succeed_tx.tx_hash,
    succeed_tx.amount,
    succeed_tx.status,
    succeed_tx.updatedAt.toTimeString(),
  ).catch((err) => logger.error(`sendWithdrawSucceededMail failed`, err))

  if (succeed_tx.Currency.symbol !== 'VND') {
    notifyTransaction(
      succeed_tx.Currency.symbol,
      succeed_tx.tx_type,
      succeed_tx.id,
      succeed_tx.User.username,
      succeed_tx.address,
      succeed_tx.tx_hash,
      succeed_tx.amount,
      succeed_tx.createdAt.toTimeString(),
      succeed_tx.status,
    )
  }
}

export async function updateFailedWithdrawalTransaction(
  main_wallet: MainWallet,
  tx: MainWalletTransaction,
) {
  const failed_tx = await prisma.mainWalletTransaction.update({
    where: {
      id: tx.id,
    },
    data: {
      status: 'FAILED',
    },
    include: {
      Currency: true,
      User: true,
    },
  })

  await prisma.mainWalletChange.create({
    data: {
      MainWallet: {
        connect: {
          id: main_wallet.id,
        },
      },
      amount: failed_tx.amount,
      event_id: failed_tx.id,
      event_type: 'TRANSACTION',
    },
  })

  sendWithdrawFailedMail(
    failed_tx.User.email,
    failed_tx.User.username,
    failed_tx.Currency.symbol,
    failed_tx.address,
    failed_tx.amount,
    failed_tx.status,
    failed_tx.updatedAt.toTimeString(),
  )
  notifyTransaction(
    failed_tx.Currency.symbol,
    failed_tx.tx_type,
    failed_tx.id,
    failed_tx.User.username,
    failed_tx.address,
    failed_tx.tx_hash,
    failed_tx.amount,
    failed_tx.createdAt.toTimeString(),
    failed_tx.status,
  )
}

export function calculateFee(
  amount: number,
  feeFlat: number,
  feePct: number,
  adminConfigFeePct: number,
) {
  let fee = 0
  if (adminConfigFeePct) {
    fee = math
      .add(math.mul(amount, adminConfigFeePct).toNumber(), feeFlat)
      .toNumber()
  } else {
    fee = math.add(math.mul(amount, feePct).toNumber(), feeFlat).toNumber()
  }
  return fee
}

// export async function getTransactionAmount(
//   symbol: string,
//   tx_hash: string,
//   address: string,
// ) {
//   const currencies = await prisma.currency.findMany({
//     where: {
//       symbol: symbol,
//     },
//   })
//   const currency = currencies[0]
//   let to_address = ''
//   let amount = 0
//   if (currency.crypto_service === 'ETHEREUM') {
//     const ethereum_tx_data = await getEthereumTransactionInfo(tx_hash)
//     if (currency.symbol == 'ETH') {
//       to_address = ethereum_tx_data['to']
//       amount = Number(Web3.utils.fromWei(ethereum_tx_data['value'], 'ether'))
//     } else if (currency.symbol === 'USDT') {
//       const crypto_data = currency.crypto_data as ETHCryptoData
//       to_address = Web3.utils.toChecksumAddress(
//         '0x' + ethereum_tx_data['input'].slice(34, 74),
//       )
//       amount = math
//         .div(
//           Web3.utils.hexToNumber('0x' + ethereum_tx_data['input'].slice(74)),
//           Math.pow(10, crypto_data.decimals),
//         )
//         .toNumber()
//     }
//     if (to_address === Web3.utils.toChecksumAddress(address)) {
//       return amount
//     }
//   } else if (currency.crypto_service === 'BITCOIN') {
//     const bitcoin_tx_data = await getBitcoinTransactionInfo(tx_hash)
//     const outputs = bitcoin_tx_data['out'] as any[]
//     const output = outputs.find((i) => i.addr === address)
//     if (output) {
//       amount = bitcore.Unit.fromSatoshis(output.value).toBTC()
//       return amount
//     }
//   }
//   return 0
// }
