import { Erc20__factory } from '../types/ethers'
import { getProvider, getProviderByChain } from './providers'

export const provider = getProvider()

export function getErc20Contract(address: string, signer?: any) {
  const provider = getProvider()
  // console.log("[getErc20Contract] provider: ", provider.connection.url);
  return Erc20__factory.connect(address, signer || provider)
}

export function getErc20ContractByChain(
  address: string,
  rpc_urls: string[],
  signer?: any,
) {
  const provider = getProviderByChain(rpc_urls)
  // console.log("[getErc20Contract] provider: ", provider.connection.url);
  return Erc20__factory.connect(address, signer || provider)
}
