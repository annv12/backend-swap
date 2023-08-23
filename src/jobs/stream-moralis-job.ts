import Moralis from 'moralis'
import { EvmChain } from '@moralisweb3/common-evm-utils'
import { Currency, PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

export async function addAddressToMoralisStream() {
  try {
    await Moralis.start({ apiKey: process.env.MORALIS_API_KEY })
    const mainWalletAddresess = await prisma.mainWalletAddress.findMany({
      where: {}
    })

    const addresses = mainWalletAddresess.map((m) => m.address)
    const streamId = process.env.MORALIS_STREAM_ID
    // Now we attach bobs address to the stream
    await Moralis.Streams.addAddress({
      address: [...new Set(addresses)],
      id: streamId,
    })
  } catch (error) {
    console.log(
      '🚀 ~ file: moralis-v2-utils.ts:39 ~ moralisStreamAddress ~ error:',
      error,
    )
    throw new Error(
      `Failed to watch address on Moralis`,
      error,
    )
  }
}

addAddressToMoralisStream()