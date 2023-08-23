import express from 'express'
import Prisma from '@prisma/client'
import { includes } from 'ramda'
import { processDepositToUserMainWallet } from '../helpers/deposit-helper'
import { MainWallet, MainWalletAddress, PrismaClient } from '@prisma/client'
import BigNumber from 'bignumber.js'
import { MoralisStreamTransactions, Erc20Transfer, Tx } from './moralis.type'
const prisma = new Prisma.PrismaClient()

type MoralisTokenTransfer = {
  objectId: string
  block_hash: string
  block_timestamp: Date
  updatedAt: Date
  transaction_hash: string
  transaction_index: number
  log_index: number
  createdAt: Date
  block_number: number
  token_address: string
  to_address: string
  from_address: string
  value: string
  decimal: number
}

type MoralisTransaction = {
  objectId: string
  block_hash: string
  gas_price: number
  hash: string
  nonce: number
  to_address: string
  transaction_index: number
  value: string
  gas: number
  block_number: number
  from_address: string
}

export function webhookBscTokenTransfersRouter() {
  const router = express.Router()

  router.get('/ping', async (req, res) => {
    res.status(200).json({
      message: 'pong',
    })
  })

  router.post('/bscTokenTransfers', async (req, res) => {
    const data: MoralisTokenTransfer = req.body?.object || req.body
    if (!data?.transaction_hash) {
      return res.status(400).send('Missing transaction_hash')
    }

    const currency = await prisma.currency.findFirst({
      where: {
        crypto_data: {
          path: ['contract_address'],
          equals: data.token_address.toLowerCase(),
        },
      },
    })
    if (!currency) return res.status(400).send('Missing currency')
    const process = await processDeposit(data, currency.id, prisma)

    if (process?.error) return res.status(400).send(process.message)
    res.status(200).json({
      message: `Deposit ${currency?.symbol} to ${data?.to_address} success`,
    })
  })

  router.post('/token-transfers', async (req, res) => {
    const data: MoralisTokenTransfer = req.body?.object || req.body
    if (!data?.transaction_hash) {
      return res.status(400).send('Missing transaction_hash')
    }

    const currency = await prisma.currency.findFirst({
      where: {
        crypto_data: {
          path: ['contract_address'],
          equals: data.token_address.toLowerCase(),
        },
      },
    })
    if (!currency) return res.status(400).send('Missing currency')
    const process = await processDeposit(data, currency.id, prisma)

    if (process?.error) return res.status(400).send(process.message)
    res.status(200).json({
      message: `Deposit ${currency?.symbol} to ${data?.to_address} success`,
    })
  })

  router.post('/bsc-transactions', async (req, res) => {
    const data: MoralisTransaction = req.body?.object || req.body
    if (!data?.hash) {
      return res.status(400).send('Missing hash')
    }

    const currency = await prisma.currency.findFirst({
      where: {
        symbol: 'BNB',
      },
    })
    if (!currency) return res.status(400).send('Missing currency')

    const process = await processDeposit(data, currency.id, prisma)

    if (process?.error)
      return res.status(400).json({
        error: true,
        message: process.message,
        data: process.data || {},
      })
    res.status(200).json({
      message: `Deposit ${currency.symbol} to ${data.to_address} success`,
    })
  })

  router.post('/matic-transactions', async (req, res) => {
    const data: MoralisTransaction = req.body?.object || req.body
    if (!data?.hash) {
      return res.status(400).send('Missing hash')
    }

    const currency = await prisma.currency.findFirst({
      where: {
        symbol: 'MATIC',
      },
    })
    if (!currency) return res.status(400).send('Missing currency')

    const process = await processDeposit(data, currency.id, prisma)

    if (process?.error)
      return res.status(400).json({
        error: true,
        message: process.message,
        data: process.data || {},
      })
    res.status(200).json({
      message: `Deposit ${currency.symbol} to ${data.to_address} success`,
    })
  })

  router.post('/eth-transactions', async (req, res) => {
    const data: MoralisTransaction = req.body?.object || req.body
    if (!data?.hash) {
      return res.status(400).send('Missing hash')
    }

    const currency = await prisma.currency.findFirst({
      where: {
        symbol: 'ETH',
      },
    })
    if (!currency) return res.status(400).send('Missing currency')

    const process = await processDeposit(data, currency.id, prisma)

    if (process?.error)
      return res.status(400).json({
        error: true,
        message: process.message,
        data: process.data || {},
      })
    res.status(200).json({
      message: `Deposit ${currency.symbol} to ${data.to_address} success`,
    })
  })

  router.post('/stream/monitor-wallet', async (req, res) => {
    const data: MoralisStreamTransactions = req.body
    if (!data.confirmed)
      return res.status(200).json({ message: 'Not confirmed' })
    const { erc20Transfers, txs } = data

    if (!erc20Transfers.length && !txs.length)
      return res.status(200).json({ message: 'No transactions' })

    try {
      if (erc20Transfers.length) {
        await Promise.all(
          erc20Transfers.map(async (transfer) => {
            const currency = await prisma.currency.findFirst({
              where: {
                symbol: transfer.tokenSymbol,
              },
            })
            if (!currency) return res.status(400).send('Missing currency')
            const process = await processDepositErc20(
              transfer,
              currency.id,
              prisma,
            )
            if (process?.error) return res.status(400).send(process.message)
          }),
        )
      } else if (txs.length) {
        await Promise.all(
          txs.map(async (tx) => {
            const currency = await prisma.currency.findFirst({
              where: {
                crypto_data: {
                  path: ['chainId'],
                  equals: data.chainId,
                },
              },
            })
            if (!currency) return res.status(400).send('Missing currency')
            const process = await processDepositToken(tx, currency.id, prisma)
            if (process?.error) return res.status(400).send(process.message)
          }),
        )
      }

      res.status(200).json({
        message: `Deposit success`,
      })
    } catch (error) {
      res.status(400).json({ error: true, message: error.message })
    }
  })

  return router
}

async function processDeposit(data, currencyId, prisma: PrismaClient) {
  const txExist = await prisma.mainWalletTransaction.findFirst({
    where: {
      tx_hash: data.transaction_hash || data.hash,
    },
  })

  if (txExist) return { error: true, message: 'Transaction already exist' }

  const mainWalletAddressByTransaction =
    await prisma.mainWalletAddress.findMany({
      where: {
        address: {
          equals: data.to_address.toLowerCase(),
          mode: 'insensitive',
        },
      },
      include: {
        MainWallet: true,
      },
    })

  const mainWallets = mainWalletAddressByTransaction.map(
    (address) => address.MainWallet,
  )

  const mainWallet = mainWallets.find(
    (wallet) => wallet.currency_id === currencyId,
  )

  if (!mainWallet)
    return {
      error: true,
      message: 'Missing main wallet',
      data: {
        mainWalletAddressByTransaction,
        mainWallets,
        mainWallet,
        currencyId,
      },
    }

  const mainWalletAddress = mainWalletAddressByTransaction.find(
    (m) => m.main_wallet_id === mainWallet.id,
  )

  if (!mainWalletAddress)
    return { error: true, message: 'Missing mainWalletAddress' }
  try {
    await processDepositToUserMainWallet(
      mainWalletAddress,
      new BigNumber(data.value).div(1e18).toString(),
      data?.hash || data?.transaction_hash,
      prisma,
    )
  } catch (error) {
    return { error: true, message: error.message }
  }
}

async function processDepositErc20(
  data: Erc20Transfer,
  currencyId,
  prisma: PrismaClient,
) {
  const txExist = await prisma.mainWalletTransaction.findFirst({
    where: {
      tx_hash: data.transactionHash,
    },
  })

  if (txExist) return { error: true, message: 'Transaction already exist' }

  const mainWalletAddressByTransaction =
    await prisma.mainWalletAddress.findMany({
      where: {
        address: {
          equals: data.to,
          mode: 'insensitive',
        },
      },
      include: {
        MainWallet: true,
      },
    })

  const mainWallets = mainWalletAddressByTransaction.map(
    (address) => address.MainWallet,
  )

  const mainWallet = mainWallets.find(
    (wallet) => wallet.currency_id === currencyId,
  )

  if (!mainWallet)
    return {
      error: true,
      message: 'Missing main wallet',
      data: {
        mainWalletAddressByTransaction,
        mainWallets,
        mainWallet,
        currencyId,
      },
    }

  const mainWalletAddress = mainWalletAddressByTransaction.find(
    (m) => m.main_wallet_id === mainWallet.id,
  )

  if (!mainWalletAddress)
    return { error: true, message: 'Missing mainWalletAddress' }
  try {
    await processDepositToUserMainWallet(
      mainWalletAddress,
      new BigNumber(data.value).div(1e18).toString(),
      data.transactionHash,
      prisma,
    )
  } catch (error) {
    return { error: true, message: error.message }
  }
}

async function processDepositToken(data: Tx, currencyId, prisma: PrismaClient) {
  const txExist = await prisma.mainWalletTransaction.findFirst({
    where: {
      tx_hash: data.hash,
    },
  })

  if (txExist) return { error: true, message: 'Transaction already exist' }

  const mainWalletAddressByTransaction =
    await prisma.mainWalletAddress.findMany({
      where: {
        address: {
          equals: data.toAddress,
          mode: 'insensitive',
        },
      },
      include: {
        MainWallet: true,
      },
    })

  const mainWallets = mainWalletAddressByTransaction.map(
    (address) => address.MainWallet,
  )

  const mainWallet = mainWallets.find(
    (wallet) => wallet.currency_id === currencyId,
  )

  if (!mainWallet)
    return {
      error: true,
      message: 'Missing main wallet',
      data: {
        mainWalletAddressByTransaction,
        mainWallets,
        mainWallet,
        currencyId,
      },
    }

  const mainWalletAddress = mainWalletAddressByTransaction.find(
    (m) => m.main_wallet_id === mainWallet.id,
  )

  if (!mainWalletAddress)
    return { error: true, message: 'Missing mainWalletAddress' }
  try {
    await processDepositToUserMainWallet(
      mainWalletAddress,
      new BigNumber(data.value).div(1e18).toString(),
      data.hash,
      prisma,
    )
  } catch (error) {
    return { error: true, message: error.message }
  }
}
