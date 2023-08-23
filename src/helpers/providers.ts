require('dotenv').config()
import { ethers } from 'ethers'

const RPC_NODE_1 = process.env.RPC_NODE_1
const RPC_NODE_2 = process.env.RPC_NODE_2
const RPC_NODE_3 = process.env.RPC_NODE_3

export const providers = [RPC_NODE_1, RPC_NODE_2, RPC_NODE_3]

function getRndInteger(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export function getProvider() {
  const selectedRpc = providers[getRndInteger(0, providers.length - 1)]
  // console.log('🚀 ~> selectedRpc', selectedRpc)
  return new ethers.providers.JsonRpcProvider(selectedRpc)
}

export function getProviderByChain(rpc_urls: string[]) {
  const selectedRpc = rpc_urls[getRndInteger(0, rpc_urls.length - 1)]
  return new ethers.providers.JsonRpcProvider(selectedRpc)
}
