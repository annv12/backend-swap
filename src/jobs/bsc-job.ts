require('dotenv').config()
import { PrismaClient, Currency, MainWalletAddress } from '@prisma/client'
import logger from '../lib/logger'
import {
  getGasPrice,
  getLastBlock,
  getLogs,
  getEthBalance,
  getTokenBalance,
  sendEthTransaction,
  sendTokenTransaction,
  getBalanceByChainWithKey,
  sendEthTransactionByChain,
} from '../eth-service'
import * as math from '../lib/math'
// @ts-ignore
import { TransferEvent } from 'ethers/Erc20'
import BigNumber from 'bignumber.js'
import { processDepositToUserMainWallet } from '../helpers/deposit-helper'
import { ethers } from 'ethers'
import {
  updateFailedWithdrawalTransaction,
  updateSucceedWithdrawalTransaction,
  verifyMainWallet,
} from '../lib/main-wallet-utils'
import { ETHCryptoData } from './ethereum-job'
import { notifyMasterWalletBalance } from '../lib/notify-utils'

// const prisma = new PrismaClient()

type ETHScanData = {
  current_block: number
  delay_block: number
  max_checking_block: number
}

type ETHEncryptData = {
  master_address: string
  private_key: string
}

type CurrencyCryptoData = {
  contract_address: string
  gas_limit: number
  max_fee: number
  min_eth_for_collect: string
}

export async function executeDepositErc20Token(prisma: PrismaClient) {
  const masterWallets = await prisma.masterWallet.findMany({
    where: {
      Currency: {
        crypto_service: 'ETHEREUM',
      },
      NOT: {
        Currency: {
          symbol: 'ETH',
        },
      },
    },
    include: {
      Currency: true,
    },
  })

  const pr = masterWallets.map(async (masterWallet) => {
    const scan_data = masterWallet.scan_data as ETHScanData
    const from_block = scan_data.current_block
    const delay_block = scan_data.delay_block
    const max_checking_block = scan_data.max_checking_block
    let to_block = await getLastBlock()
    if (to_block > from_block + max_checking_block) {
      to_block = from_block + max_checking_block
    }
    to_block = to_block - delay_block

    logger.debug(`Scan USDT Blockchain from ${from_block} to ${to_block}`)
    const wallet_addresses = await prisma.mainWalletAddress.findMany({
      where: {
        MainWallet: {
          currency_id: masterWallet.currency_id,
        },
      },
      select: {
        address: true,
      },
    })
    const addresses = wallet_addresses.map((i) => i.address)

    let tx_logs: TransferEvent[] = []
    try {
      tx_logs = await getLogs(from_block, to_block)
      logger.debug(`Found ${tx_logs.length} Transfer logs`, tx_logs)
    } catch (error) {
      logger.error(`getLogs() error: \n`, error)
      throw Error(error)
    }

    const pr2 = tx_logs
      .filter((log) => addresses.includes(log.args.to))
      .map(async (log) => {
        const { from, to, value } = log.args
        const amount = new BigNumber(value.toString()).div(1e18).toFixed(8)
        if (!addresses.includes(to)) return
        if (value.eq(0)) return
        logger.info(`tx ${log.transactionHash} -> amount: ${amount}`)

        const recieverWalletAddresses = await prisma.mainWalletAddress.findMany(
          {
            where: {
              address: to,
              MainWallet: {
                currency_id: masterWallet.currency_id,
              },
            },
            include: {
              MainWallet: true,
            },
          },
        )
        const recieverWalletAddress = recieverWalletAddresses[0]
        if (!recieverWalletAddress) return
        logger.info(`Send tx to address: ${recieverWalletAddress.address}`)

        const existedTxs = await prisma.mainWalletTransaction.findFirst({
          where: {
            tx_hash: log.transactionHash,
            tx_type: 'DEPOSIT',
            currency_id: masterWallet.currency_id,
          },
        })

        if (existedTxs) return
        logger.debug(
          `Create MainWalletTransaction: ${log.transactionHash} ${amount}`,
        )

        await processDepositToUserMainWallet(
          recieverWalletAddress,
          amount,
          log.transactionHash,
          prisma,
        )
      })

    // try {
    //   sendDepositSucceededMail(
    //     usdt_tx.User.email,
    //     usdt_tx.User.username,
    //     usdt_tx.Currency.symbol,
    //     usdt_tx.address,
    //     usdt_tx.tx_hash,
    //     usdt_tx.amount,
    //     usdt_tx.status,
    //     usdt_tx.createdAt.toTimeString(),
    //   )
    //   notifyTransaction(
    //     usdt_tx.Currency.symbol,
    //     usdt_tx.tx_type,
    //     usdt_tx.id,
    //     usdt_tx.User.username,
    //     usdt_tx.address,
    //     usdt_tx.tx_hash,
    //     usdt_tx.amount,
    //     usdt_tx.createdAt.toTimeString(),
    //   )
    //   pushNotication(
    //     'DEPOSIT',
    //     {
    //       prisma: prisma,
    //       user: usdt_tx.User.id,
    //       i18n: null,
    //       redlock: null,
    //       pubsub: null,
    //       request: null,
    //       role: usdt_tx.User.role,
    //     },
    //     null,
    //     `You have recharged [${usdt_tx.amount}] [${
    //       usdt_tx.Currency.symbol
    //     }] at [${format(new Date(), 'HH:mm, dd/MM/yyyy')}].
    //           If this activity is not your own, please contact us immediately.`,
    //   )
    // } catch (err) {
    //   logger.error(`Send main wallet transaction notification failed`)
    // }

    Promise.all(pr2)

    await prisma.masterWallet.update({
      where: {
        id: masterWallet.id,
      },
      data: {
        scan_data: {
          ...scan_data,
          current_block: to_block,
        },
      },
    })
  })

  await Promise.all(pr)
}

// executeDepositErc20Token(prisma).catch((e) => console.log(e))

export async function collectBSCToMaster(prisma: PrismaClient) {
  const eth_currencies = await prisma.currency.findMany({
    where: {
      crypto_service: 'BSC',
    },
    include: {
      MasterWallet: true,
    },
  })

  await Promise.all(
    eth_currencies.map(async (currency) => {
      const wallet_addresses = await prisma.mainWalletAddress.findMany({
        where: {
          MainWallet: {
            Currency: {
              id: currency.id,
            },
          },
        },
        include: {
          MainWallet: true,
        },
      })

      await Promise.all(
        wallet_addresses.map(async (wallet_address) => {
          const currency = eth_currencies.find(
            (c) => c.id === wallet_address.MainWallet.currency_id,
          )
          if (currency.symbol !== 'BNB') {
            forwardBscTokenToMaster(currency, wallet_address, prisma)
          } else {
            forwardBscEthToMaster(currency, wallet_address, prisma)
          }
        }),
      )
    }),
  )
}

async function forwardBscTokenToMaster(
  currency: Currency,
  wallet_address: MainWalletAddress,
  prisma: PrismaClient,
) {
  const master_wallet = await prisma.masterWallet.findFirst({
    where: {
      Currency: {
        symbol: 'BNB',
      },
    },
  })
  const crypto_data = currency.crypto_data as CurrencyCryptoData
  const ms_encrypy_data = master_wallet.encrypt_data as ETHEncryptData
  const master_wallet_address = ms_encrypy_data.master_address
  const fee_wallet_private_key = ms_encrypy_data.private_key

  const token_balance = await getTokenBalance(
    crypto_data.contract_address,
    wallet_address.address,
  )

  if (Number(token_balance) === 0) return
  logger.info(
    `[forwardBscTokenToMaster] user: ${
      wallet_address.address
    } Balance: ${token_balance.toString()}`,
  )

  const gas_price = await estimate_gas_price(
    crypto_data.gas_limit,
    crypto_data.max_fee,
  )

  const tx_hash = await sendTokenTransaction(
    wallet_address,
    crypto_data.contract_address,
    master_wallet_address,
    token_balance.toString(),
    crypto_data.gas_limit.toString(),
    gas_price,
    fee_wallet_private_key,
  )

  if (!tx_hash) {
    logger.error(`[forwardBscTokenToMaster] Cannot send token to master`)
    return
  }
  logger.info(`[forwardBscTokenToMaster] Sent to master tx: ${tx_hash}`)

  await prisma.transactionMaster.create({
    data: {
      Currency: {
        connect: {
          id: currency.id,
        },
      },
      tx_type: 'IN',
      address: wallet_address.address,
      master_address: master_wallet_address,
      tx_hash: tx_hash,
      amount: Number(ethers.utils.formatEther(token_balance).toString()),
      MainWalletAddress: {
        connect: {
          id: wallet_address.id,
        },
      },
    },
  })

  await prisma.mainWalletAddress.update({
    where: {
      id: wallet_address.id,
    },
    data: {
      need_sync_balance: true,
    },
  })
}

async function forwardBscEthToMaster(
  currency: Currency,
  wallet_address: MainWalletAddress,
  prisma: PrismaClient,
) {
  const crypto_data = currency.crypto_data as CurrencyCryptoData
  //@ts-ignore
  const masterWallet = currency?.MasterWallet[0]
  const master_crypto_data = masterWallet.encrypt_data as ETHEncryptData

  const balance = await getEthBalance(wallet_address.address)
  if (balance.lte(ethers.utils.parseEther(crypto_data.min_eth_for_collect)))
    return

  logger.info(
    `[forwardBscEthToMaster] user: ${
      wallet_address.address
    } Balance: ${balance.toString()}`,
  )

  const amount = balance.sub(
    ethers.utils.parseEther(crypto_data.min_eth_for_collect),
  )

  const tx_hash = await sendEthTransaction(
    wallet_address.address,
    wallet_address.encrypt_data,
    master_crypto_data.master_address,
    new BigNumber(amount.toString()),
  )

  if (!tx_hash) {
    logger.error(`[forwardBscEthToMaster] Cannot send eth to master`)
    return
  }
  logger.info(`[forwardBscEthToMaster] Sent to master tx: ${tx_hash}`)

  await prisma.transactionMaster.create({
    data: {
      Currency: {
        connect: {
          id: currency.id,
        },
      },
      tx_type: 'IN',
      address: wallet_address.address,
      master_address: master_crypto_data.master_address,
      tx_hash: tx_hash,
      amount: Number(ethers.utils.formatEther(amount).toString()),
      MainWalletAddress: {
        connect: {
          id: wallet_address.id,
        },
      },
    },
  })

  await prisma.mainWalletAddress.update({
    where: {
      id: wallet_address.id,
    },
    data: {
      need_sync_balance: true,
    },
  })
}

export async function estimate_gas_price(gas_limit: number, max_fee: number) {
  const estimate_gas_price = await getGasPrice()
  const gas_price = math.mul(estimate_gas_price.toString(), 1.1).toString()
  const estimate_fee = math.mul(gas_price, gas_limit)
  const max_fee_wei = ethers.utils.parseUnits(max_fee.toString(), 'gwei')
  if (estimate_fee.toNumber() > Number(max_fee_wei)) {
    return parseInt(
      math.div(max_fee_wei.toString(), gas_limit.toString()).toString(),
    ).toString()
  }
  return gas_price
}

export async function withdrawEthFromMaster(prisma: PrismaClient) {
  const eth_currencies = await prisma.currency.findMany({
    // where: {
    //   crypto_service: 'BSC',
    // },
    include: {
      // MasterWallet: true,
      MainWallet: true,
    },
  })
  const masterWallet = await prisma.masterWallet.findFirst({})
  const master_crypto_data = masterWallet.encrypt_data as ETHEncryptData
  const master_wallet_address = master_crypto_data.master_address
  const feeWalletPrivateKey = master_crypto_data.private_key

  await Promise.all(
    eth_currencies.map(async (currency) => {
      const pending_txs = await prisma.mainWalletTransaction.findMany({
        where: {
          Currency: {
            id: currency.id,
          },
          tx_type: 'WITHDRAW',
          status: 'PENDING',
          OR: [
            {
              is_notified_admin: false,
            },
            {
              AND: [
                {
                  is_notified_admin: true,
                },
                {
                  approved_status: 'APPROVED',
                },
              ],
            },
          ],
        },
        orderBy: {
          createdAt: 'asc',
        },
        include: {
          User: true,
        },
      })

      await Promise.all(
        pending_txs.map(async (pending_tx) => {
          const crypto_data = currency.crypto_data as ETHCryptoData
          const gas_limit = crypto_data.gas_limit
          const max_fee = crypto_data.max_fee

          const main_wallet = currency.MainWallet.find(
            (m) => m.currency_id === pending_tx.currency_id,
          )

          // Verify transaction before withdrawing
          const is_valid_wallet = await verifyMainWallet(main_wallet)
          if (!is_valid_wallet) {
            logger.error('[WITHDRAW ETH] invalid wallet🚧')
            await updateFailedWithdrawalTransaction(main_wallet, pending_tx)
            return
          }
          const send_amount = ethers.utils.parseEther(
            math
              .sub(pending_tx.amount.toString(), pending_tx.fee.toString())
              .toString(),
          )

          if (Number(send_amount) <= 0) return

          const master_balance = await getBalanceByChainWithKey(
            feeWalletPrivateKey,
            crypto_data,
          )

          if (Number(master_balance) < Number(send_amount)) {
            logger.debug(
              `Master balance is not enough ${
                currency.symbol
              }, Master balance: ${master_balance}, Withdraw amount: ${new BigNumber(
                send_amount.toString(),
              )
                .dividedBy(1e18)
                .toString()}`,
            )
            notifyMasterWalletBalance(
              currency.symbol,
              Number(send_amount.toString()),
              Number(master_balance.toString()),
            )
            return
          }

          const gas_price = await estimate_gas_price(gas_limit, max_fee)
          try {
            const tx_hash = await sendEthTransactionByChain(
              feeWalletPrivateKey,
              pending_tx.address,
              ethers.BigNumber.from(send_amount.toString()),
              crypto_data,
            )

            if (tx_hash.includes('0x')) {
              await updateSucceedWithdrawalTransaction(pending_tx, tx_hash)
            }
          } catch (error) {
            await updateFailedWithdrawalTransaction(main_wallet, pending_tx)
            logger.error('[WHITHDRAW ETH] Error when withdraw ❌', error)
            return
          }
        }),
      )
    }),
  )
}
// withdrawEthFromMaster(prisma).catch((err) => logger.error(err))
