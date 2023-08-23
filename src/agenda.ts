require('dotenv').config()
import Agenda, { Job, JobPriority } from 'agenda'
import logger from './lib/logger'
import { sendCopyTradeCommission } from './jobs/copytrade_job'
import { refundExpiredPromotionCodeJob } from './jobs/refund-expired-gifcode-job'
import {
  executeDepositErc20Token,
  collectBSCToMaster,
  withdrawEthFromMaster,
} from './jobs/bsc-job'
import { PrismaClient } from '@prisma/client'
import {
  collectEthAndTokenToMasterWallet,
  excuteCollectEvmNative,
  excuteDepositEthereum,
} from './jobs/ethereum-job'
import Moralis from 'moralis'

const mongoHost =
  process.env.NODE_ENV === 'production' ? 'mongodb' : '127.0.0.1'

const agenda = new Agenda({ db: { address: `mongodb://${mongoHost}/agenda` } })

const prisma = new PrismaClient()

// agenda.define(
//   'excute_deposit_bsc_usdt',
//   // { priority: 'high', concurrency: 10 },
//   async (job: Job) => {
//     logger.info('Start Scanning ETH transactions from blockchain')
//     await executeDepositErc20Token(prisma)
//   },
// )

// agenda.define(
//   'excute_deposit_eth',
//   // { priority: 'high', concurrency: 10 },
//   async (job: Job) => {
//     logger.info('Start Scanning ETH transactions from blockchain')
//     await excuteDepositEthereum(prisma)
//   },
// )

agenda.define(
  'collect_eth_token_to_master',
  // { priority: 'high', concurrency: 10 },
  async (job: Job) => {
    logger.info('Start Collecting BSC to Master')
    await collectEthAndTokenToMasterWallet(prisma)
  },
)

agenda.define(
  'collect_eth_to_master',
  // { priority: 'high', concurrency: 10 },
  async (job: Job) => {
    logger.info('Start Collecting BSC to Master')
    await excuteCollectEvmNative('ETH', prisma)
  },
)

agenda.define(
  'collect_bnb_to_master',
  // { priority: 'high', concurrency: 10 },
  async (job: Job) => {
    logger.info('Start Collecting BSC to Master')
    await excuteCollectEvmNative('BNB', prisma)
  },
)

agenda.define(
  'collect_matic_to_master',
  // { priority: 'high', concurrency: 10 },
  async (job: Job) => {
    logger.info('Start Collecting BSC to Master')
    await excuteCollectEvmNative('MATIC', prisma)
  },
)

agenda.define(
  'withdraw_eth_from_master',
  // { priority: 'high', concurrency: 10 },
  async (job: Job) => {
    logger.info('Start withdraw BSC from Master')
    await withdrawEthFromMaster(prisma)
  },
)

// agenda.define(
//   'update_leader_board',
//   { priority: JobPriority.high, concurrency: 10 },
//   async (job: Job) => {
//     logger.info('Start UPDATE Leader Board')
//     await updateLeaderBoard(true)
//   },
// )
// agenda.define(
//   'update_statistic',
//   { priority: JobPriority.high, concurrency: 10 },
//   async (job: Job) => {
//     logger.info('Start UPDATE Daily Statistic')
//     await updateDailyStatistic()
//   },
// )

agenda.define('send_copytrade_commission', async (job: Job) => {
  logger.info('Start Daily send_copytrade_commission')
  await sendCopyTradeCommission(prisma)
})

// agenda.define(
//   'renew_service_subscription',
//   { priority: JobPriority.high, concurrency: 10 },
//   async (job: Job) => {
//     logger.info('Start Daily renew_service_subscription')
//     await renewServiceSubscription()
//   },
// )

agenda.define('refund_buy_promotion_code_expired', async (job: Job) => {
  logger.info('Start Hourly refund_buy_promotion_code_expired')
  await refundExpiredPromotionCodeJob()
})
;(async function () {
  await Moralis.start({ apiKey: process.env.MORALIS_API_KEY })
  // IIFE to give access to async/await
  await agenda.start()

  // await agenda.every('*/2 * * * *', 'excute_deposit_bsc_usdt')
  // await agenda.every('0 */3 * * *', 'excute_deposit_eth')
  await agenda.every('0 /12 * * *', 'collect_eth_token_to_master')
  await agenda.every('0 /12 * * *', 'collect_eth_to_master')
  await agenda.every('0 /12 * * *', 'collect_bnb_to_master')
  await agenda.every('0 /12 * * *', 'collect_matic_to_master')
  await agenda.every('0 /12 * * *', 'withdraw_eth_from_master')
  // await agenda.every('*/2 * * * *', 'excute_deposit_ethereum_token')
  // await agenda.every('*/5 * * * *', 'update_ethereum_wallet_address_balance')
  // await agenda.every('*/10 * * * *', 'collect_eth_token_to_master')
  // await agenda.every('*/5 * * * *', 'excute_deposit_btc')
  // await agenda.every('*/5 * * * *', 'update_btc_transaction_confirmation')
  // await agenda.every('*/30 * * * *', 'update_btc_wallet_address_balance')
  // await agenda.every('*/30 * * * *', 'collect_btc_to_master')
  // await agenda.every('*/5 * * * *', 'withdraw_eth_transaction')
  // await agenda.every('*/1 * * * *', 'withdraw_erc20_token_transaction')
  // await agenda.every('*/5 * * * *', 'withdraw_bitcoin_transaction')
  // await agenda.every('*/5 * * * *', 'withdraw_bank_transaction')
  // await agenda.every('*/5 * * * *', 'update_btc_master_wallet_balance')
  // await agenda.every('*/5 * * * *', 'update_ethereum_master_wallet_balance')
  // await agenda.every('0 0 * * *', 'update_leader_board')
  // await agenda.every('0 0 * * *', 'update_statistic')
  await agenda.every('0 0 * * *', 'send_copytrade_commission')
  // await agenda.every('0 0 * * *', 'renew_service_subscription')
  await agenda.every('0 * * * *', 'refund_buy_promotion_code_expired')
})()
