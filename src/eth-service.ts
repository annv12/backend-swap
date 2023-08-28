require('dotenv').config()
// import { TransactionConfig } from 'web3-core'
import { MainWalletAddress, Currency } from '@prisma/client'
import ethers, { Wallet, utils, BigNumber as BN } from 'ethers'
import BigNumber from 'bignumber.js'
import { NonceManager } from '@ethersproject/experimental'
import {
  getErc20Contract,
  getErc20ContractByChain,
} from './helpers/contract-accessor'
import { getProvider, getProviderByChain } from './helpers/providers'
import logger from './lib/logger'
import { getBscTransactionIndex } from './lib/moralis-utils'
import { ETHCryptoData } from './jobs/ethereum-job'
import math from './lib/math'

export function generateAddress() {
  const { address, privateKey } = ethers.Wallet.createRandom()
  return { address: address, encrypt_data: privateKey }
}

// export async function getBalance(address: string) {
//   const balanceWei = await web3.eth.getBalance(address)
//   return balanceWei
// }

// export async function getTokenBalance(
//   address: string,
//   sc_address: string,
//   abi: AbiItem[],
// ) {
//   const smart_contract = new web3.eth.Contract(abi, sc_address)
//   const balance = await smart_contract.methods
//     .balanceOf(web3.utils.toChecksumAddress(address))
//     .call()
//   return balance
// }

export async function getTokenBalance(c_address: string, address: string) {
  const constract = getErc20Contract(c_address)
  return await constract.balanceOf(address)
}
export async function getEthBalance(address: string) {
  const provider = getProvider()
  return await provider.getBalance(address)
}
export async function getEthBalanceByChain(
  address: string,
  rpc_urls: string[],
) {
  const provider = getProviderByChain(rpc_urls)
  return await provider.getBalance(address)
}

export async function getBalanceByChainWithKey(
  private_key: string,
  crypto_data: ETHCryptoData,
) {
  const provider = getProviderByChain(crypto_data.rpc_urls)
  const wallet = new Wallet(private_key, provider)

  if (crypto_data.contract_address.length > 0) {
    const contract = getErc20ContractByChain(
      crypto_data.contract_address,
      crypto_data.rpc_urls,
      wallet,
    )
    return await contract.balanceOf(wallet.address)
  }
  return await wallet.getBalance()
}

export async function getLogs(from_block: number, to_block: number) {
  const erc20Contract = getErc20Contract(process.env.BSC_USDT_ADDRESS)
  const filter = erc20Contract.filters.Transfer()
  const history = await erc20Contract.queryFilter(filter, from_block, to_block)

  return history
}

export async function getLastBlock() {
  const provider = getProvider()
  return provider.getBlockNumber()
}

export async function getLastBlockByChain(rpc_urls: string[]) {
  const provider = getProviderByChain(rpc_urls)
  return provider.getBlockNumber()
}

// export function getTransactionInfo(tx_hash: string) {
//   return web3.eth.getTransaction(tx_hash)
// }

// export function getTransactionInfoByIndex(block: number, index: number) {
//   return web3.eth.getTransactionFromBlock(block, index)
// }

export function getTransactionFromBlock(
  block: number,
  crypto_data: ETHCryptoData,
) {
  const provider = getProviderByChain(crypto_data.rpc_urls)
  const blockData = provider.getBlockWithTransactions(block)
  return blockData
}

// export function getBlockInfo(block: number) {
//   return web3.eth.getBlock(block)
// }

export function getGasPrice() {
  const provider = getProvider()
  return provider.getGasPrice()
}

// export async function sendTransaction(
//   from_address: string,
//   private_key: string,
//   to_address: string,
//   amount: string,
//   gas_limit: string,
//   gas_price: string,
//   nonce: number = null,
// ) {
//   let tx_nonce = nonce
//   if (!tx_nonce) {
//     tx_nonce = await web3.eth.getTransactionCount(
//       web3.utils.toChecksumAddress(from_address),
//     )
//   }

//   const transaction_config: TransactionConfig = {
//     from: web3.utils.toChecksumAddress(from_address),
//     to: web3.utils.toChecksumAddress(to_address),
//     value: amount,
//     nonce: tx_nonce,
//     gas: gas_limit,
//     gasPrice: gas_price,
//   }

//   const signed_tx = await web3.eth.accounts.signTransaction(
//     transaction_config,
//     private_key,
//   )
//   if (!signed_tx) return

//   const tx = await web3.eth.sendSignedTransaction(signed_tx.rawTransaction)
//   return signed_tx.transactionHash
// }

// export async function sendTokenTransaction(
//   from_address: string,
//   private_key: string,
//   sc_address: string,
//   to_address: string,
//   amount: string,
//   abi: AbiItem[],
//   gas_limit: string,
//   gas_price: string,
//   nonce: number = null,
// ) {
//   let tx_nonce = nonce
//   if (!tx_nonce) {
//     tx_nonce = await web3.eth.getTransactionCount(
//       web3.utils.toChecksumAddress(from_address),
//     )
//   }

//   const smart_contract = new web3.eth.Contract(abi, sc_address)

//   const tx_data = await smart_contract.methods
//     .transfer(web3.utils.toChecksumAddress(to_address), amount)
//     .encodeABI()

//   const raw_tx = {
//     nonce: tx_nonce,
//     from: web3.utils.toChecksumAddress(from_address),
//     to: web3.utils.toChecksumAddress(sc_address),
//     value: 0,
//     gas: gas_limit,
//     gasPrice: gas_price,
//     data: tx_data,
//   }

//   const signed_tx = await web3.eth.accounts.signTransaction(raw_tx, private_key)
//   if (!signed_tx) {
//     logger.error('[sendTokenTransaction()] Cannot create signed_tx', raw_tx)
//     throw Error(`[sendTokenTransaction()] Cannot create signed_tx`)
//   }

//   try {
//     const tx = await web3.eth.sendSignedTransaction(signed_tx.rawTransaction)
//     logger.info("[sendTokenTransaction()] Success", signed_tx.transactionHash)
//     return signed_tx.transactionHash
//   } catch (e) {
//     logger.error('[sendTokenTransaction()] Error', e)
//     throw Error(e)
//   }
// }

export async function sendTokenTransaction(
  wallet_address: MainWalletAddress,
  sc_address: string,
  to_address: string,
  amount: string,
  gas_limit: string,
  gas_price: string,
  master_private_key: string,
) {
  const master_wallet = new Wallet(master_private_key, getProvider())
  const user_wallet = new Wallet(wallet_address.encrypt_data, getProvider())
  const contract = getErc20Contract(sc_address, user_wallet)

  const bnb_user_balance = await getEthBalance(wallet_address.address)
  // let unit = await contract.estimateGas.transfer(to_address, amount)
  // let gas = unit.mul(await getGasPrice())

  if (bnb_user_balance.lte(utils.parseEther('0.001'))) {
    logger.info(`[forward BNB user] adress: ${wallet_address.address}`)

    try {
      const tx_fee = await master_wallet.sendTransaction({
        to: wallet_address.address,
        value: utils.parseEther('0.001'),
      })
      await tx_fee.wait()
    } catch (error) {
      logger.error(`[forward BNB user] error: ${error}`)
      return
    }
  }

  // let nonce = await user_wallet.getTransactionCount()
  try {
    logger.info(`[forward user] adress: ${wallet_address.address}`)
    // const index = await getBscTransactionIndex(wallet_address.address)

    const tx = await contract.transfer(to_address, amount, {
      // nonce: nonce + 1,
      // gasLimit: gas_limit,
      // gasPrice: gas_price + 100000,
    })

    await tx.wait()
    return tx.hash
  } catch (error) {
    logger.error(`[sendTokenTransaction] error: ${error}`)
    return
  }
}

export async function sendEthTransaction(
  from_address: string,
  private_key: string,
  to_address: string,
  amount: BigNumber,
) {
  try {
    const wallet = new Wallet(private_key, getProvider())
    const tx = await wallet.sendTransaction({
      from: from_address,
      to: to_address,
      value: new BigNumber(amount.toString()).toString(),
    })
    await tx.wait()
    return tx.hash
  } catch (error) {
    logger.error(`[sendEthTransaction] error: ${error}`)
    return
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function sendEthTransactionByChain(
  private_key: string,
  to_address: string,
  amount: ethers.BigNumber,
  crypto_data: ETHCryptoData,
) {
  const wallet = new Wallet(
    private_key,
    getProviderByChain(crypto_data.rpc_urls),
  )
  //@ts-ignore
  const managedSigner = new NonceManager(wallet)
  // let baseNonce = managedSigner.getTransactionCount()
  // let nonceOffset = 0
  // async function getNonce() {
  //   const c = await managedSigner.getTransactionCount()
  //   // managedSigner.incrementTransactionCount(c+1)

  //   return c + 1
  // }

  // const gas_price = await estimate_gas_price(
  //   crypto_data.gas_limit,
  //   crypto_data.max_fee,
  //   crypto_data.rpc_urls,
  // )

  const gasPrice = await wallet.provider.getGasPrice()
  // const gasLimit = BN.from(crypto_data.gas_limit)

  if (crypto_data.contract_address.length > 0) {
    console.log('send erc20 token on chain', crypto_data.chain)
    const contract = getErc20ContractByChain(
      crypto_data.contract_address,
      crypto_data.rpc_urls,
      wallet,
    )
    const tx = await contract.transfer(to_address, amount.toString(), {
      // gasLimit: gasLimit.toString(),
      // gasPrice: gasPrice.mul(11).div(10),
      // nonce:  getNonce(),
    })
    await tx.wait()
    return tx.hash
  } else {
    if (['ETH', 'GOERLI', 'POLYGON'].includes(crypto_data.chain)) return null
    const tx = await managedSigner.sendTransaction({
      to: to_address,
      value: amount,
      // gasLimit: gasLimit,
      // gasPrice: gasPrice,
      // nonce:  getNonce(),
    })
    await tx.wait()
    return tx.hash
  }
}

async function estimate_gas_price(
  gas_limit: number,
  max_fee: number,
  rpc_urls: string[],
) {
  const provider = getProviderByChain(rpc_urls)
  const estimate_gas_price = await provider.getGasPrice()

  const gas_price = math.mul(estimate_gas_price.toString(), 1.2)
  const estimate_fee = math.mul(gas_price, gas_limit)
  const max_fee_wei = utils.parseUnits(max_fee.toString(), 'gwei')
  if (estimate_fee.toNumber() > Number(max_fee_wei)) {
    return math
      .div(max_fee_wei.toString(), gas_limit.toString())
      .decimalPlaces(0)
  }
  return gas_price.decimalPlaces(0)
}
