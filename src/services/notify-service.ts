import { PrismaClient, Prisma } from '@prisma/client'
import Redis from 'ioredis'
import { notifyTele, sendMessage } from '../lib/notify-utils'
require('dotenv').config()
import fs from 'fs'
const FormData = require('form-data')
import QRCode from 'qrcode'
import fetch from 'node-fetch'
import { ValidationError } from '../lib/error-util'

const botToken =
  process.env.BOT_TOKEN || '5816998358:AAHvKovaJ4S_7lXaN05x3QKU-hS2Ck7VfJo'
const TOKEN_BOT_FAKE = process.env.TOKEN_BOT_FAKE || '6167699222:AAHfqsmsK_DyuHeNE-Ei1ntA6qrS7KkC4w0'
const chatIds = process.env.CHAT_ID || '5387205654'
const redisHost = process.env.NODE_ENV === 'production' ? 'redis' : '127.0.0.1'
const maxRound = parseInt(process.env.MAX_ROUND_INSURANCE) || 7

interface Account {
  email: string,
  username: string,
}
const PATH_USER_FAKE = 'user_fake.json'
const userFakes: Account[] = fs.existsSync(PATH_USER_FAKE)
  ? JSON.parse(fs.readFileSync(PATH_USER_FAKE).toString())
  : []
const users = userFakes.map(user => `'${user.username}'`)

const redisOptions = {
  host: redisHost,
  port: 6379,
  retryStrategy: (times: number) => {
    throw new ValidationError({ message: 'Connect redis fail' })
    return Math.min(times * 50, 2000)
  },
}

const subscriber = new Redis(redisOptions)
const prisma = new PrismaClient()

subscriber.subscribe('lock-round')
subscriber.subscribe('notify-withdraw')
subscriber.subscribe('refund-user')
subscriber.subscribe('create-copytrade')
subscriber.subscribe('update-copytrade')
subscriber.subscribe('send-gift-code')
subscriber.subscribe('change-mode')
subscriber.subscribe('round-result')
subscriber.subscribe('buy-agency')

type OrderResult = {
  username: string
  exchange_name: string
  up_amount: number
  down_amount: number
  is_enable: boolean
  round: number
  copiers: number
  profit: number
}

async function main() {
  console.error(`[Notify Service]  Starting...`)
  subscriber.on('message', async (channel, message) => {
    console.log(
      '🚀 ~ file: notify-order-round.ts:41 ~ subscriber.on ~ channel, message',
      channel,
      message,
    )
    switch (channel) {
      case 'lock-round':
        await notifyOrder(message)
        break
      case 'notify-withdraw':
        await notifyWithdraw(message)
        break
      case 'refund-user':
        await notifyRefund(message)
        break
      case 'create-copytrade':
        await createCopytrade(message)
        break
      case 'update-copytrade':
        await updateCopytrade(message)
        break
      case 'send-gift-code':
        await notifySendGiftCode(message)
        break
      case 'change-mode':
        const { mode } = JSON.parse(message)
        await notifyTele(`Admin change Mode to ${mode}`)
        break
      case 'round-result':
        const { exchangeName, type } = JSON.parse(message)
        await notifyTele(`Admin set result exchange ${exchangeName} to ${type}`)
        break
      case 'buy-agency':
        const {user, ref} = JSON.parse(message)
        let refMsg = ref ? `Ref của user ${ref}` : ''
        await notifyTele(`User ${user} đã mua quyền đại lý.
${refMsg}`)
        break

    }
  })
}

const formatNumber = (value: number) => Number.isInteger(value) ? value : value.toFixed(2)

const summary = async (roundId: number, accountType: string, userFake: string[], isFake: boolean) => {
  try {
    let result = await prisma.$queryRawUnsafe<OrderResult[]>(`
  SELECT
    u.username,
  ex."name" as exchange_name,
  SUM(CASE WHEN bet_type =  'UP' THEN bet_amount  else 0 END) up_amount,
  SUM(CASE WHEN bet_type =  'DOWN' THEN bet_amount else 0 END) down_amount,
  COALESCE(ui.is_enable, FALSE) as is_enable,
  COALESCE(ui.round, 0) as round, 
  COALESCE(ct.copiers, 0) as copiers,
  COALESCE(profit.profit, 0) AS profit
  FROM "order" as o
  INNER JOIN "user" as u ON o.user_id = u.id
  INNER JOIN exchange_pair as ex ON o.exchange_pair_id = ex.id
    LEFT JOIN (
    SELECT user_id, is_enable, round
      FROM
        user_insurance
      WHERE
        is_enable = TRUE
        AND insurance_trader_id IS NULL
    GROUP BY id, user_id, is_enable, round
    ) as  ui ON u.id = ui.user_id	
    LEFT JOIN (
      SELECT trader_id, count(copier_id) as copiers
      FROM
        copy_trade
        RIGHT JOIN (
          SELECT
            user_id,
            approved_status
          FROM
            trading_expert_register
          WHERE
            trading_expert_register.approved_status = 'APPROVED') ter ON copy_trade.trader_id = ter.user_id
        WHERE
          status = 'START'
        GROUP BY trader_id
        ) AS ct ON u.id = ct.trader_id
    LEFT JOIN (
      SELECT
        us.username, "order".user_id, sum(order_result.win_amount) - sum("order".bet_amount) AS profit
      FROM
        "order"
        INNER JOIN order_result ON "order".order_result_id = order_result.id
        INNER JOIN "user" AS us ON order_result.user_id = us.id
      WHERE "order".account_type = '${accountType}'
      GROUP BY
        us.username,
        "order".user_id) AS profit ON profit.user_id = u.id
  WHERE
    u.username ${isFake ? '' : 'NOT'} IN (${userFake.join(',')}) AND
    round_id = ${roundId}
    AND o.account_type = '${accountType}'
    AND o.copy_trade_id IS NULL
  GROUP BY
    u.username,
    ex."name",
    ui.is_enable,
    ui.round,
    ct.copiers,
    profit.profit
  ORDER BY
    exchange_name
  `)
    // console.log("🚀 ~ file: notifyOrder.ts:44 ~ subscriber.on ~ result", result.length)
    let res = result.reduce((obj, item) => {
      let msg =
        `- *${item.username}* (${item.profit == 0 ? '' : item.profit > 0 ? '+' : '-'}$${formatNumber(Math.abs(
          item.profit,
        ))})
        ${item.exchange_name.replaceAll('USDT', '')}, up: $${
          formatNumber(item.up_amount)
        },  down: $${formatNumber(item.down_amount)},  insurance: ${item.is_enable}` +
        (item.is_enable ? `(${maxRound - item.round})` : '') +
        `, copiers: ${item.copiers}`
      if (obj[item.exchange_name]) {
        obj[item.exchange_name]['totalUp'] +=
          item.up_amount * (item.copiers + 1)
        obj[item.exchange_name]['totalDown'] +=
          item.down_amount * (item.copiers + 1)
        obj[item.exchange_name]['totalProfitUp'] +=
          item.up_amount > 0 ? item.profit : 0
        obj[item.exchange_name]['totalProfitDown'] +=
          item.down_amount > 0 ? item.profit : 0
        obj[item.exchange_name]['msg'] = `${obj[item.exchange_name]['msg']}
  
${msg}`
      } else {
        obj[item.exchange_name] = {
          totalUp: item.up_amount * (item.copiers + 1),
          totalDown: item.down_amount * (item.copiers + 1),
          totalProfitUp: item.up_amount > 0 ? item.profit : 0,
          totalProfitDown: item.down_amount > 0 ? item.profit : 0,
          msg,
        }
      }
      return obj
    }, {})

    let strTotal = Object.keys(res).reduce((msg: string, key) => {
      let str = `          ${key.replaceAll('USDT', '')}: total up: $${
        formatNumber(res[key]['totalUp'])
      } (${res[key]['totalProfitUp'] == 0 ? '' : res[key]['totalProfitUp'] > 0 ? '+' : '-'}$${formatNumber(Math.abs(
        res[key]['totalProfitUp'],
      ))})  
                  total down: $${formatNumber(res[key]['totalDown'])} (${
        res[key]['totalProfitDown'] == 0 ? '' : res[key]['totalProfitDown'] > 0 ? '+' : '-'
      }$${formatNumber(Math.abs(res[key]['totalProfitDown']))})
  ${res[key]['msg']}`
      if (msg) {
        return `${msg}

${str}`
      }
      return str
    }, '')

    return {
      length: result.length,
      message: strTotal,
    }
  } catch (error) {
    console.log("🚀 ~ file: notify-service.ts:194 ~ summary ~ error:", error)
    return {
      length: 0,
      message: '',
    }
  }
}

async function notifyOrder(message) {
  try {
    const roundId = parseInt(message)
    console.log(
      '🚀 ~ file: notifyOrder.ts:23 ~ subscriber.on ~ roundId',
      roundId,
    )

    let [summaryMain, summaryPromotion, summaryMainFake, summaryPromotionFake] = await Promise.all([
      summary(roundId, "MAIN", users, false),
      summary(roundId, "PROMOTION", users, false),
      summary(roundId, "MAIN", users, true),
      summary(roundId, "PROMOTION", users, true),
    ])

    if (summaryMain.length > 0 || summaryPromotion.length > 0){
      await notifyTele(`
          
===================
Round: ${roundId}
  ${summaryMain.length > 0 ? `*Tài khoản chính*:
      Total user: ${summaryMain.length}
  ${summaryMain.message}`: ''}
  ${summaryPromotion.length > 0 ? `

  *Tài khoản Promotion:*
      Total user: ${summaryPromotion.length}
  ${summaryPromotion.message}`: ''}
`)
    }

    if (summaryMainFake.length > 0 || summaryPromotionFake.length > 0){
      await notifyTele(`
          
===================
Round: ${roundId}
  ${summaryMainFake.length > 0 ? `*Tài khoản chính*:
      Total user: ${summaryMainFake.length}
  ${summaryMainFake.message}`: ''}
  ${summaryPromotionFake.length > 0 ? `

  *Tài khoản Promotion:*
      Total user: ${summaryPromotionFake.length}
  ${summaryPromotionFake.message}`: ''}
===================

`, TOKEN_BOT_FAKE)
    }
  } catch (err) {
    console.log('🚀 ~ file: notify-order-round.ts:126 ~ notifyOrder ~ err', err)
  }
}

async function notifyWithdraw(message) {
  try {
    const { username, symbol, amount, address } = JSON.parse(message)
    await Promise.all([
      notifyTele(
        `username: [${username}] withdraw ${amount} ${symbol} to address [${address}]`,
      ),
      sendQRCode(address),
    ])
  } catch (err) {
    console.log(
      '🚀 ~ file: notify-order-round.ts:142 ~ notifyWithdraw ~ err',
      err,
    )
  }
}
async function sendQRCode(data: string) {
  let fileName = `${data}.png`
  await QRCode.toFile(fileName, data)
  await Promise.all(
    chatIds.split(',').map(async (chatId) => {
      try {
        let url = `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendPhoto`
        let formData = new FormData()
        formData.append('chat_id', chatId)
        formData.append('photo', await fs.createReadStream(fileName))
        const request_config = {
          method: 'post',
          headers: formData.getHeaders(),
          body: formData,
        }
        await fetch(url, request_config)
      } catch (err: any) {
        console.log(
          '🚀 ~ file: notify-order-round.ts:162 ~ chatIds.split ~ err',
          err,
        )
      }
    }),
  )
  fs.rmSync(fileName)
}

main().catch((err) => {
  console.error(`[Notify Service] ${err.message}`, err)
})

async function notifyRefund(message) {
  try {
    const { roundId, username, amount } = JSON.parse(message)
    await Promise.all([
      notifyTele(`Round: [${roundId}] refund user [${username}] \$${amount}`),
    ])
  } catch (err) {
    console.log('🚀 ~ file: notify-services.ts:193 ~ notifyRefund ~ err', err)
  }
}

async function createCopytrade(message) {
  try {
    const { user, trader, copyTrade } = JSON.parse(message)
    await Promise.all([
      notifyTele(
        `
====================
User [${user}] copy trader [${trader}]:
amount: \$${copyTrade.amount}
percent_per_trade: [${copyTrade.percent_per_trade}]
max_amount_per_trade: [${copyTrade.max_amount_per_trade}]
fixed_amount_per_trade: [${copyTrade.fixed_amount_per_trade}]
stoploss: ${copyTrade.stop_loss * 100}%
takeProfit: ${copyTrade.take_profit * 100}%
profit_sharing: [${copyTrade.profit_sharing}]
====================
`,
      ),
    ])
  } catch (err) {
    console.log('🚀 ~ file: notify-services.ts:193 ~ notifyRefund ~ err', err)
  }
}

async function updateCopytrade(message) {
  try {
    const {
      user,
      trader,
      amount,
      stopLoss,
      takeProfit,
      status,
      remain,
      profit_sharing,
      percent_per_trade,
      max_amount_per_trade,
      fixed_amount_per_trade,
    } = JSON.parse(message)
    let msg = `=========================
User [${user}] update copy trader [${trader}]:`
    msg = status ? msg + '\n' + status : msg
    msg = amount ? msg + '\n' + amount : msg
    msg = remain ? msg + '\n' + remain : msg
    msg = stopLoss ? msg + '\n' + stopLoss : msg
    msg = takeProfit ? msg + '\n' + takeProfit : msg
    msg = profit_sharing ? msg + '\n' + profit_sharing : msg
    msg = percent_per_trade ? msg + '\n' + percent_per_trade : msg
    msg = max_amount_per_trade ? msg + '\n' + max_amount_per_trade : msg
    msg = fixed_amount_per_trade ? msg + '\n' + fixed_amount_per_trade : msg

    await Promise.all([
      notifyTele(
        `
${msg}
=========================
`,
      ),
    ])
  } catch (err) {
    console.log('🚀 ~ file: notify-services.ts:258 ~ notifyRefund ~ err', err)
  }
}

async function notifySendGiftCode(message) {
  try {
    const { chatId, promotionCode } = JSON.parse(message)

    await sendMessage(
      process.env.BOT_TOKEN,
      chatId,
      `Congratulations! You’ve been received $${
        promotionCode.amount
      } by giftcode ${promotionCode.code}
Please access Voption.org -> Wallet page -> Exchange Wallet -> Enter code -> Apply to earn $${
  promotionCode.amount
}
Guidle: ${process.env.LINK_GUIDLE}
Support 24/7: @voption_admin`,
    )
  } catch (err) {
    console.log('🚀 ~ file: notify-services.ts:258 ~ notifyRefund ~ err', err)
  }
}

// summary("3210140", "MAIN",).then(console.log)