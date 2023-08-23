export interface MoralisStreamTransactions {
  confirmed: boolean
  chainId: string
  abi: any[]
  streamId: string
  tag: string
  retries: number
  block: Block
  logs: Log[]
  txs: Tx[]
  txsInternal: any[]
  erc20Transfers: Erc20Transfer[]
  erc20Approvals: any[]
  nftTokenApprovals: any[]
  nftApprovals: NftApprovals
  nftTransfers: any[]
  nativeBalances: any[]
}

export interface Block {
  number: string
  hash: string
  timestamp: string
}

export interface Log {
  logIndex: string
  transactionHash: string
  address: string
  data: string
  topic0: string
  topic1: string
  topic2: string
  topic3: any
}

export interface Tx {
  hash: string
  gas: string
  gasPrice: string
  nonce: string
  input: string
  transactionIndex: string
  fromAddress: string
  toAddress: string
  value: string
  type: string
  v: string
  r: string
  s: string
  receiptCumulativeGasUsed: string
  receiptGasUsed: string
  receiptContractAddress: any
  receiptRoot: any
  receiptStatus: string
}

export interface Erc20Transfer {
  transactionHash: string
  logIndex: string
  contract: string
  from: string
  to: string
  value: string
  tokenName: string
  tokenSymbol: string
  tokenDecimals: string
  valueWithDecimals: string
}

export interface NftApprovals {
  ERC721: any[]
  ERC1155: any[]
}
