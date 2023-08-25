import {
  getLastBlockByChain,
  getTransactionFromBlock,
  sendEthTransactionByChain,
} from '../eth-service'
// import { sendDepositSucceededMail } from '../lib/mail-utils'
import logger from '../lib/logger'
import BigNumber from 'bignumber.js'
import { processDepositToUserMainWallet } from '../helpers/deposit-helper'
import { PrismaClient } from '@prisma/client'
import { Wallet, ethers } from 'ethers'
import * as R from 'ramda'
import { getProviderByChain } from '../helpers/providers'
import {
  getNativeBalance,
  getWalletTokenBalances,
} from '../lib/moralis-v2-utils'
import fetch from 'node-fetch'
import { notifyTele } from '../lib/notify-utils'

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

export type ETHCryptoData = {
  // abi: string
  // topics: string[]
  // decimals: number
  gas_limit: number
  contract_address: string
  // transfer_function: string
  max_fee: number
  min_eth_for_collect: string
  rpc_urls: string[]
  chainId: string
  chain: string
}

export async function excuteDepositEthereum(prisma) {
  const master_wallets = await prisma.masterWallet.findMany({
    where: {
      Currency: {
        crypto_service: 'ETHEREUM',
        symbol: 'ETH',
      },
    },
    include: {
      Currency: true,
    },
  })

  Promise.all(
    master_wallets.map(async (master_wallet) => {
      const scan_data = master_wallet.scan_data as ETHScanData
      const crypto_data = master_wallet.Currency.crypto_data as ETHCryptoData
      const from_block = scan_data.current_block
      const delay_block = scan_data.delay_block
      const max_checking_block = scan_data.max_checking_block
      let to_block = await getLastBlockByChain(crypto_data.rpc_urls)

      if (to_block > from_block + max_checking_block) {
        to_block = from_block + max_checking_block
      }
      to_block = to_block - delay_block

      logger.debug(`Scan ETH Blockchain from ${from_block} to ${to_block}`)
      const wallet_addresses = await prisma.mainWalletAddress.findMany({
        where: {
          MainWallet: {
            currency_id: master_wallet.currency_id,
          },
        },
        select: {
          address: true,
        },
      })
      const addresses = wallet_addresses.map((i) => i.address)

      for (let block = from_block; block < to_block; block++) {
        const block_data = await getTransactionFromBlock(block, crypto_data)
        const transactions = block_data.transactions
        transactions.forEach(async (tx) => {
          if (!tx.to) return
          const to_address = tx.to
          const tx_hash = tx.hash
          const amount = new BigNumber(tx.value.toString())
            .dividedBy(1e18)
            .toString()

          if (!addresses.includes(to_address)) return
          logger.info(`tx ${tx_hash} -> amount: ${amount}`)

          const recieverWalletAddresses =
            await prisma.mainWalletAddress.findMany({
              where: {
                address: to_address,
                MainWallet: {
                  currency_id: master_wallet.currency_id,
                },
              },
              include: {
                MainWallet: true,
              },
            })
          const recieverWalletAddress = recieverWalletAddresses[0]
          if (!recieverWalletAddress) return
          logger.info(`Send tx to address: ${recieverWalletAddress.address}`)
          const existedTxs = await prisma.mainWalletTransaction.findFirst({
            where: {
              tx_hash,
              tx_type: 'DEPOSIT',
              currency_id: master_wallet.currency_id,
            },
          })

          if (existedTxs) return
          logger.debug(`Create MainWalletTransaction: ${tx_hash} ${amount}`)
          await processDepositToUserMainWallet(
            recieverWalletAddress,
            amount,
            tx_hash,
            prisma,
          )
        })
      }
      logger.debug(`Update master wallet ${master_wallet.id} to ${to_block}`)
      await prisma.masterWallet.update({
        where: {
          id: master_wallet.id,
        },
        data: {
          scan_data: {
            ...scan_data,
            current_block: to_block,
          },
        },
      })
    }),
  )
}

export async function excuteCollectEvmNative(
  cyrrencySymbol: string,
  prisma: PrismaClient,
) {
  const masterWallet = await prisma.masterWallet.findFirst({
    where: {
      Currency: {
        symbol: cyrrencySymbol,
      },
    },
    include: {
      Currency: true,
    },
  })

  if (!masterWallet) {
    console.log(`Cannot find master wallet for ${cyrrencySymbol}`)
    return
  }

  const masterWalletData = masterWallet.encrypt_data as ETHEncryptData

  const mainWallet = await prisma.mainWallet.findMany({
    where: {
      Currency: {
        symbol: cyrrencySymbol,
      },
    },
    include: {
      MainWalletAddress: true,
      Currency: true,
    },
  })
  if (mainWallet.length === 0) {
    console.log(`Cannot find main wallet for ${cyrrencySymbol}`)
    return
  }
  console.log(`🚀 Start process for ${mainWallet.length} mainWallet:`)

  const filteredWallets = mainWallet
    .filter((wallet) => wallet.MainWalletAddress?.address)
    .map((wallet) => wallet.MainWalletAddress.address)

  const chunkedWallets = R.splitEvery(25, mainWallet)
  const chunkedAddress = R.splitEvery(25, filteredWallets)

  for (const [index, wallets] of chunkedWallets.entries()) {
    const addresses = chunkedAddress[index]
    console.log(`START page ${index}`, addresses)

    // @ts-ignore
    const chainName = wallets[0].Currency.crypto_data.chainId
    if (!chainName) {
      console.log('Cannot find chain name')
      continue
    }

    // const nativeBalance =
    //   await MoralisV2.EvmApi.balance.getNativeBalancesForAddresses({
    //     chain: EvmChain.BSC,
    //     walletAddresses: addresses,
    //   })
    const nativeBalance = await fetch(
      `https://deep-index.moralis.io/api/v2/wallets/balances?chain=${chainName}${addresses.reduce(
        (acc, address, index) => {
          return acc + `&wallet_addresses%5B${index}%5D=${address}`
        },
        '',
      )}`,
      {
        headers: {
          'x-api-key':
            'xn6zQOWUUwy7JUku3GO1lUmqB1md2DU6jalBfqX8PvWYdaURuZOyQ8o2xDhSpIAk',
        },
      },
    ).then((res) => res.json())
    console.log(
      '🚀 ~> file: test.ts:53 ~> main ~> nativeBalance:',
      nativeBalance,
    )

    const walletWithBalance = wallets.map((wallet) => {
      const balance = nativeBalance[0].wallet_balances.find(
        (balance) => balance.address === wallet.MainWalletAddress.address,
      )

      return {
        ...wallet,
        balance: new BigNumber(balance?.balance),
      }
    })

    for (const userWallet of walletWithBalance) {
      const cryptoCurrencyData = userWallet.Currency
        .crypto_data as ETHCryptoData

      console.log(
        `Wallet ${userWallet.MainWalletAddress.address} - ${userWallet.balance
          .div(1e18)
          .toString()}`,
      )

      if (userWallet.balance.gt(cryptoCurrencyData.min_eth_for_collect)) {
        const amount = userWallet.balance.minus(0.01)
        console.log(
          `START SEND ${amount.toString()} BNB TO MASTER ${
            masterWalletData.master_address
          }`,
        )
        // create evm transaction
        const provider = new ethers.providers.JsonRpcProvider(
          cryptoCurrencyData.rpc_urls[0],
        )

        const wallet = new Wallet(
          // @ts-ignore
          userWallet.MainWalletAddress.encrypt_data.private_key,
          provider,
        )
        const tx = await wallet.sendTransaction({
          to: masterWalletData.master_address,
          value: amount.toString(),
        })
        await tx.wait()

        if (!tx.hash) return
        console.log('TX HASH: ', tx.hash)

        await prisma.transactionMaster.create({
          data: {
            Currency: {
              connect: {
                id: masterWallet.currency_id,
              },
            },
            tx_type: 'IN',
            address: userWallet.MainWalletAddress.address,
            master_address: masterWalletData.master_address,
            tx_hash: tx.hash,
            // @ts-ignore
            amount: amount.div(1e18).toString(),
            MainWalletAddress: {
              connect: {
                id: userWallet.id,
              },
            },
          },
        })

        await prisma.mainWalletAddress.update({
          where: {
            id: userWallet.id,
          },
          data: {
            need_sync_balance: true,
          },
        })
      }
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function collectEthAndTokenToMasterWallet(prisma: PrismaClient) {
  // await Moralis.start({ apiKey: process.env.MORALIS_API_KEY })
  const masterWallet = await prisma.masterWallet.findFirst({
    where: {
      Currency: {
        symbol: {
          in: ['ETH', 'BNB', 'MATIC'],
        },
      },
    },
    include: {
      Currency: true,
    },
  })

  const encrypt_data = masterWallet.encrypt_data as ETHEncryptData
  const fee_wallet_private_key = encrypt_data.private_key
  const master_wallet_crypto_data = masterWallet.Currency
    .crypto_data as ETHCryptoData
  const master_wallet_address = encrypt_data.master_address

  // const fee_wallet = new ethers.Wallet(
  //   fee_wallet_private_key,
  //   getProviderByChain(master_wallet_crypto_data.rpc_urls),
  // )

  // const feeWalletNativeBalance = await fee_wallet.getBalance()

  const mainWallets = await prisma.mainWallet.findMany({
    // where: {
    //   Currency: {
    //     symbol: {
    //       in: ['ETH', 'BNB', 'MATIC'],
    //     },
    //   },
    // },
    include: {
      Currency: true,
      MainWalletAddress: true,
    },
  })

  try {
    for (const mainWallet of mainWallets) {
      try {
        const { Currency, MainWalletAddress } = mainWallet
        if (!MainWalletAddress) continue
        const address = MainWalletAddress.address
        const crypto_data = Currency.crypto_data as ETHCryptoData
        const minEth = ethers.utils
          .parseEther(crypto_data.min_eth_for_collect)
          .mul(Currency.symbol == 'ETH' ? 3 : 2)

        const transactionExisted = await prisma.mainWalletTransaction.findFirst(
          {
            where: {
              user_id: mainWallet.user_id,
              Currency: {
                id: Currency.id,
              },
            },
          },
        )

        if (!transactionExisted) continue

        const walletTokenBalances = await getWalletTokenBalances(
          address,
          [],
          Currency,
        )

        // Collect eth with wallet not have token
        if (!walletTokenBalances.length) {
          const nativeBalance = await getNativeBalance(address, Currency)
          if (nativeBalance.lt(minEth)) {
            continue
          }
          let amount = nativeBalance.sub(minEth)
          logger.info(
            `[Transfer-eth-1] Transfer ${ethers.utils.formatEther(amount)} ${
              Currency.symbol
            } from ${address} to master wallet`,
          )
          const tx_hash = await sendEthTransactionByChain(
            MainWalletAddress.encrypt_data,
            master_wallet_address,
            amount,
            crypto_data,
          )
          await notifyTele(
            `[Transfer-eth-1] Transfer ${ethers.utils.formatEther(amount)} ${
              Currency.symbol
            } from ${address} to master wallet hash: ${tx_hash}`,
          )
          await insertTxToDb(
            tx_hash,
            Currency,
            MainWalletAddress,
            master_wallet_address,
            amount,
            prisma,
          )
          sleep(3000)
        } else {
          // Transfer token before collect eth
          for (const walletTokenBalance of walletTokenBalances) {
            const nativeBalanceBeforCollect = await getNativeBalance(
              address,
              Currency,
            )

            if (nativeBalanceBeforCollect.lt(minEth)) {
              const fee = minEth.sub(nativeBalanceBeforCollect.toString())

              logger.info(
                `[Transfer-fee] Transfer ${ethers.utils.formatEther(
                  fee,
                )} BNB from fee wallet to ${address}`,
              )

              try {
                // const crypto_data = Currency.crypto_data as ETHCryptoData
                const fee_wallet = new ethers.Wallet(
                  fee_wallet_private_key,
                  getProviderByChain(crypto_data.rpc_urls),
                )

                const tx_fee = await fee_wallet.sendTransaction({
                  to: MainWalletAddress.address,
                  value: fee,
                })
                await tx_fee.wait()

                if (tx_fee.hash) {
                  await notifyTele(
                    `[Transfer-fee] Transfer ${ethers.utils.formatEther(
                      fee,
                    )} BNB from fee wallet to ${address} hash: ${tx_fee.hash}`,
                  )
                  await prisma.transactionMaster.create({
                    data: {
                      Currency: {
                        connect: {
                          id: Currency.id,
                        },
                      },
                      tx_type: 'OUT',
                      address: MainWalletAddress.address,
                      master_address: master_wallet_address,
                      tx_hash: tx_fee.hash,
                      amount: Number(ethers.utils.formatEther(fee).toString()),
                      MainWalletAddress: {
                        connect: {
                          id: MainWalletAddress.id,
                        },
                      },
                    },
                  })
                }
                sleep(3000)
              } catch (error) {
                logger.error(`[forward fee BNB user] error: ${error}`)
                await notifyTele(`[forward fee BNB user] error: ${error}`)
                return
              }
            }

            const amount = ethers.BigNumber.from(walletTokenBalance.balance)

            logger.info(
              `[Transfer-Token] Transfer ${ethers.utils.formatEther(amount)} ${
                walletTokenBalance.symbol
              } from ${address} to master wallet`,
            )
            await notifyTele(
              `[Transfer-Token] Transfer ${ethers.utils.formatEther(amount)} ${
                walletTokenBalance.symbol
              } from ${address} to master wallet`,
            )
            const token = await prisma.currency.findFirst({
              where: {
                symbol: walletTokenBalance.symbol,
              },
            })
            const token_data = token.crypto_data as ETHCryptoData

            const tx_hash = await sendEthTransactionByChain(
              MainWalletAddress.encrypt_data,
              master_wallet_address,
              amount,
              token_data,
            )
            await insertTxToDb(
              tx_hash,
              token,
              MainWalletAddress,
              master_wallet_address,
              amount,
              prisma,
            )
            sleep(3000)
          }

          // Collect eth
          const nativeBalanceAfterCollect = await getNativeBalance(
            address,
            Currency,
          )

          if (nativeBalanceAfterCollect.lt(minEth)) continue

          const amount = nativeBalanceAfterCollect.sub(minEth)

          logger.info(
            `[Transfer-eth-2] Transfer ${ethers.utils.formatEther(amount)} ${
              Currency.symbol
            } from ${address} to master wallet`,
          )
          await notifyTele(
            `[Transfer-eth-2] Transfer ${ethers.utils.formatEther(amount)} ${
              Currency.symbol
            } from ${address} to master wallet`,
          )

          const tx_hash = await sendEthTransactionByChain(
            MainWalletAddress.encrypt_data,
            master_wallet_address,
            amount,
            crypto_data,
          )
          await insertTxToDb(
            tx_hash,
            Currency,
            MainWalletAddress,
            master_wallet_address,
            amount,
            prisma,
          )
          sleep(3000)
        }
      } catch (error) {
        console.log(
          '🚀 ~ file: ethereum-job.ts:559 ~ collectEthAndTokenToMasterWallet ~ error',
          error,
        )
        await notifyTele(
          `collectEthAndTokenToMasterWallet ~ error: ${error.message}`,
        )
      }
    }
  } catch (error) {
    console.log(
      '🚀 ~ file: ethereum-job.ts:1193 ~ collectEthAndTokenToMasterWallet ~ error',
      error,
    )
    await notifyTele(
      `collectEthAndTokenToMasterWallet ~ error: ${error.message}`,
    )
  }
}

// collectEthAndTokenToMasterWallet(prisma).then(() => {
//   console.log(
//     '🚀 ~ file: ethereum-job.ts:1194 ~ collectEthAndTokenToMasterWallet ~ done',
//   )
// })

async function insertTxToDb(
  tx_hash,
  currency,
  mainWalletAddress,
  master_address,
  amount,
  prisma,
) {
  if (!tx_hash) {
    logger.error(`[forwardBscEthToMaster] Cannot send eth to master`)
    await notifyTele(`[forwardBscEthToMaster] Cannot send eth to master`)
    return
  }
  logger.info(`[forwardBscEthToMaster] Sent to master tx: ${tx_hash}`)
  await notifyTele(`[forwardBscEthToMaster] Sent to master tx: ${tx_hash}`)

  await prisma.transactionMaster.create({
    data: {
      Currency: {
        connect: {
          id: currency.id,
        },
      },
      tx_type: 'IN',
      address: mainWalletAddress.address,
      master_address,
      tx_hash: tx_hash,
      amount: Number(ethers.utils.formatEther(amount).toString()),
      MainWalletAddress: {
        connect: {
          id: mainWalletAddress.id,
        },
      },
    },
  })

  await prisma.mainWalletAddress.update({
    where: {
      id: mainWalletAddress.id,
    },
    data: {
      need_sync_balance: true,
    },
  })
}
