import Moralis from 'moralis'
import { EvmChain } from '@moralisweb3/common-evm-utils'
import { Currency } from '@prisma/client'
import { ETHCryptoData } from '../jobs/ethereum-job'
import { ethers } from 'ethers'

export interface CryptoData {
  chain: string
  chainId: string
  max_fee: number
  rpc_urls: string[]
  gas_limit: number
  contract_address: string
  min_eth_for_collect: string
}

export async function moralisStreamAddress(address: string, currency) {
console.log('Add address to Moralis stream', address)
  // const cryptoData: CryptoData = currency.crypto_data
  try {
    // const chain = cryptoData?.chain || 'BSC_TESTNET'

    // const stream = {
    //   chains: [EvmChain[chain]], // list of blockchains to monitor
    //   description: 'monitor ' + address + ' wallet', // your description
    //   tag: currency.symbol, // give it a tag
    //   webhookUrl: process.env.PROJECT_API_URL + '/webhooks/stream/' + address, // webhook url to receive events,
    //   includeNativeTxs: true,
    // }

    // const newStream = await Moralis.Streams.add(stream)
    // const { id } = newStream.toJSON() // { id: 'YOUR_STREAM_ID', ...newStream }
    const streamId = process.env.MORALIS_STREAM_ID
    // Now we attach bobs address to the stream
    await Moralis.Streams.addAddress({
      address,
      id: streamId,
    })
  } catch (error) {
    console.log(
      '🚀 ~ file: moralis-v2-utils.ts:39 ~ moralisStreamAddress ~ error:',
      error,
    )
    throw new Error(
      `Failed to watch address on Moralis with chain ${currency.symbol}`,
      error,
    )
  }
}


export async function getNativeBalance(address: string, currency: Currency) {
  // await Moralis.start({ apiKey: process.env.MORALIS_API_KEY })

  const crypto_data = currency.crypto_data as ETHCryptoData
  const chain = crypto_data.chain
  const nativeBalance = await Moralis.EvmApi.balance.getNativeBalance({
    chain: EvmChain[chain],
    address: address,
  })
  return ethers.BigNumber.from(nativeBalance.toJSON().balance)
}

export async function getWalletTokenBalances(address: string, tokenAddresses: string[], currency: Currency) {
  // await Moralis.start({ apiKey: process.env.MORALIS_API_KEY })

  const crypto_data = currency.crypto_data as ETHCryptoData
  const chain = crypto_data.chain
  const response = await Moralis.EvmApi.token.getWalletTokenBalances({
    chain: EvmChain[chain],
    tokenAddresses,
    address
  });
  return response.raw
}
