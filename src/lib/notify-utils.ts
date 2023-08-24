import { NotificationType } from '@prisma/client'
import { format } from 'date-fns'
import DeviceDetector from 'device-detector-js'
import fetch from 'node-fetch'
import { Context } from '../context'
import logger from './logger'
require('dotenv').config()

const botToken =
  process.env.BOT_TOKEN || '5816998358:AAHvKovaJ4S_7lXaN05x3QKU-hS2Ck7VfJo'

const chatIds = process.env.CHAT_ID || '5387205654'

export enum LEVEL {
  GOOD = '#2FA44F',
  WARNING = '#DE9E31',
  DANGER = '#D50200',
}

export async function pushNotication(
  type: NotificationType,
  ctx: Context,
  noticeTitle?: string,
  message?: string,
) {
  let title = 'New notification'
  let body: string

  switch (type) {
    case 'LOGIN':
      title = noticeTitle ?? 'Successful Login'
      var userAgent = ctx.request?.headers['user-agent'] ?? ''

      let device = ''
      if (userAgent) {
        const deviceDetector = new DeviceDetector()
        const deviceInfo = deviceDetector.parse(userAgent)
        // console.log(deviceInfo)
        if (deviceInfo && deviceInfo.device) {
          device = `[${deviceInfo.os?.name ?? ''} ${
            deviceInfo.os?.version ?? ''
          }], [${deviceInfo.device?.brand} ${
            deviceInfo.device?.model && deviceInfo.device.model != ''
              ? deviceInfo.device.model
              : deviceInfo.os?.name ?? ''
          }]`
        }
      }
      body =
        message ??
        `The system has detected that your account is logged in from an IP address.

Device: ${device}
Time: ${format(new Date(), 'zzzz HH:mm, dd/MM/yyyy')}

If it was you who logged in, you can comfortably leave this message and move on to other activities on Voption.`

      break
    case 'WITHDRAW':
      title = noticeTitle ?? 'Withdrawal Successful'
      body =
        message ??
        `You have successfully withdrawn [Amount] [Currency] at [${format(
          new Date(),
          'HH:mm, dd/MM/yyyy',
        )}].
        
If this activity is not your own, please contact us immediately.`
      break
    case 'DEPOSIT':
      title = noticeTitle ?? 'Deposit Successful'
      body =
        message ??
        `You have recharged [Amount] [Currency] at [${format(
          new Date(),
          'HH:mm, dd/MM/yyyy',
        )}].
        
If this activity is not your own, please contact us immediately.`
      break
    case 'TRANSFER':
      title = noticeTitle ?? 'Internal Transfer Successful'
      body =
        message ??
        `You have transfered at [${format(new Date(), 'HH:mm, dd/MM/yyyy')}].
        
If this activity is not your own, please contact us immediately.`
      break
    case 'AGENCY':
      title = noticeTitle ?? 'Agency License Successfully Purchased'
      body =
        message ??
        `You have completed purchasing the Agency License. Now you can enjoy multiple streams of income from both trading activities and agency recruitment activities from your downlines.

If this activity is not your own, please contact us immediately.`
      break
    case 'CAMPAIGN':
      title = noticeTitle ?? 'New Campaign'
      body =
        message ??
        `Top Agency Tournament will be started in 10/2022. Please click this link to join now:
${process.env.OFFICIAL_PAGE}/events/agency-tournament`
      break
    case 'UPGRADE':
      title = noticeTitle ?? 'Upgrade account successfully'
      body =
        message ??
        `You have completed purchasing the packet. Now you can copy orders from any experts and enjoy the unlimited passive income.

If this activity is not your own, please contact us immediately.`
      break
    case 'COPYING':
      title = noticeTitle ?? 'You are copying expert'
      body =
        message ??
        `You have completed copying orders from expert

If this activity is not your own, please contact us immediately.`
      break
    //   case 'REVERT_INVESTING_FUND':
    //     title = noticeTitle ?? 'Revert Investing Fund'
    //     body =
    //       message ??
    //       `For ensuring the balance of betting fund between Call option and Put option in round xxx, your investing amount will be reverted $xxx

    // If this activity is not your own, please contact us immediately.`
    //     break
    //   case 'AGENCY_COMMISSION':
    //     title = noticeTitle ?? 'Agency Commission'
    //     body =
    //       message ?? `You have received $xxx agency commission from your downline`
    //     break
    //   case 'TRADING_COMMISSION':
    //     title = noticeTitle ?? 'Trading Commission'
    //     body =
    //       message ??
    //       `You have received $xxx trading commission from your downline`
    //     break
    //   case 'SEND_GIFT_CODE':
    //     title = noticeTitle ?? 'Giftcode Promotion'
    //     body =
    //       message ?? `Congratulations! You’ve been received $xx by giftcode xxxx expired xxx`
    //     break
    default:
      break
  }

  const tokens = await ctx.prisma.device.findMany({
    where: {
      user_id: ctx.user,
      enable: true,
    },
    select: {
      token: true,
    },
  })

  const notify = await ctx.prisma.notification.create({
    data: {
      User: {
        connect: {
          id: ctx.user,
        },
      },
      title,
      content: body,
      description: '',
      type,
    },
  })

  ctx.pubsub?.publish(`new-notify.${ctx.user}`, notify)

  await sendPushNotication(
    title,
    body,
    type,
    tokens.map((item) => item.token),
  )
}
export async function sendPushNotication(
  title: string,
  body: string,
  type: string,
  tokens: string[],
) {
  if (!process.env.FIREBASE_PUSH_KEY) {
    return
  }
  // logger.info('tokens: ', tokens)
  const host = process.env.OFFICIAL_PAGE ?? 'https://domain.com'
  const payload = {
    notification: {
      title: title,
      body: body,
      data: {
        type,
      },
      click_action: host,
      icon: host + '/icon/Favicon128x128.png',
    },
    android: {
      channel_id: 'Swap Token',
      icon: process.env.OFFICIAL_PAGE + '/icon/Favicon128x128.png',
    },
    apns: {
      payload: {
        aps: {
          'mutable-content': 1,
        },
      },
    },
    registration_ids: tokens,
    topic: type,
  }

  const result = await fetch('https://fcm.googleapis.com/fcm/send', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: {
      Authorization: 'key=' + process.env.FIREBASE_PUSH_KEY,
      'Content-Type': 'application/json',
    },
  })
  // console.log('result notify: ', result)
  return result
}

async function send_mastermost_notification(
  msg: string,
  title: string,
  url: string,
  channel: string,
  username: string,
  level: LEVEL,
) {
  const payload = {
    username: username,
    title: title,
    channel: channel,
    icon_url: 'https://voption.org/images/logo.png',
    attachments: [
      {
        title: title,
        color: level,
        text: msg,
        mrkdwn_in: ['text', 'pretext'],
      },
    ],
  }

  let result = await fetch(url, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  // console.log('result: ', result)
  return true
}

export async function notifyThresholdWithdrawTransaction(
  tx_id: string,
  currency_symbol: string,
  username: string,
  amount: number,
  date_added: string,
) {
  const msg = `ID: ${tx_id}\nUser: ${username}\nCurrency: ${currency_symbol}\nAmount: ${amount.toLocaleString()}\nDate: ${date_added}`
  await send_mastermost_notification(
    msg,
    'Withdraw Threshold Notification',
    'https://eevee.coinhe.io/hooks/8oxkbpapppb7jcxdodmpi37tir',
    'Voption-withdraw-threshold',
    'Swap Token',
    LEVEL.WARNING,
  )
  return true
}

export function notifyBankTransaction(
  tx_type: string,
  tx_id: string,
  bank: string,
  username: string,
  amount: number,
  balance: number,
  date_added: string,
) {
  const lelvel = tx_type == 'DEPOSIT' ? LEVEL.GOOD : LEVEL.WARNING
  const msg = `Bank: ${bank}\nID: ${tx_id}\nUser: ${username}\nAmount: ${amount.toLocaleString()}\nBalance: ${balance.toLocaleString()}\nDate: ${date_added}`
  send_mastermost_notification(
    msg,
    tx_type,
    'https://eevee.coinhe.io/hooks/ej49de4mofbp8d6fr1cbzuyo5o',
    'Voption-bank-notification',
    'Swap Token',
    lelvel,
  )
  return true
}

export function notifyUnknownBankTransaction(sms: string) {
  send_mastermost_notification(
    sms,
    'Unknown Bank Transaction',
    'https://eevee.coinhe.io/hooks/ej49de4mofbp8d6fr1cbzuyo5o',
    'Voption-bank-notification',
    'Swap Token',
    LEVEL.DANGER,
  )
  return true
}

export async function notifyMasterWalletBalance(
  symbol: string,
  withdraw_amount: number,
  balance: number,
) {
  const msg = `Currency: ${symbol}\nCurrent Balance: ${balance.toLocaleString()}\nWithdraw Amount: ${withdraw_amount.toLocaleString()}`
  await send_mastermost_notification(
    msg,
    'Master Balance is not enough',
    'https://eevee.coinhe.io/hooks/3rqzca8zqtdmbb948ujgbm5ieo',
    'Voption-master-wallet-monitor',
    'Swap Token',
    LEVEL.WARNING,
  )
  return true
}

export function notifyTransaction(
  currency: string,
  tx_type: string,
  tx_id: string,
  username: string,
  address: string,
  tx_hash: string,
  amount: number,
  date_added: string,
  status: string = 'SUCCEED',
  balance: number = 0,
) {
  let lelvel = LEVEL.GOOD
  if (status === 'SUCCEED') {
    lelvel = tx_type == 'DEPOSIT' ? LEVEL.GOOD : LEVEL.WARNING
  } else {
    lelvel = LEVEL.DANGER
  }
  let msg = ''
  if (currency === 'VND') {
    msg = `Currency: ${currency}\nID: ${tx_id}\nUser: ${username}\nBank: ${address}\nHash: ${tx_hash}\nAmount: ${amount.toLocaleString()}\nBalance: ${balance.toLocaleString()}\nDate: ${date_added}`
  } else {
    msg = `Currency: ${currency}\nID: ${tx_id}\nUser: ${username}\nAddress: ${address}\nHash: ${tx_hash}\nAmount: ${amount.toLocaleString(
      undefined,
      { minimumFractionDigits: 8 },
    )}\nDate: ${date_added}`
  }

  send_mastermost_notification(
    msg,
    tx_type,
    'https://eevee.coinhe.io/hooks/i5artnk7kjgqxkpnn4khr4r1ky',
    'Voption-transaction-all-notification',
    'Swap Token',
    lelvel,
  )
  return true
}

export async function notifyTele(content: string, tokenBot: string = '') {
  let token = tokenBot || botToken
  let characters = [
    '[',
    ']',
    '(',
    ')',
    '~',
    '`',
    '>',
    '#',
    '+',
    '-',
    '=',
    '|',
    '{',
    '}',
    '.',
    '!',
  ]
  content = characters.reduce((str: string, character) => {
    return str.replaceAll(character, `\\${character}`)
  }, content)
  await Promise.all(
    chatIds.split(',').map(async (chatId) => {
      try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chat_id: chatId,
            text: content,
            parse_mode: 'markdownv2',
          }),
        })
        // console.log("🚀 ~ file: notify-utils.ts:354 ~ notifyTele ~ res", res)
      } catch (error) {
        console.log(
          '🚀 ~ file: notify-utils.ts:355 ~ notifyTele ~ error',
          error,
        )
      }
    }),
  )
}

export const sendMessage = async (
  botToken: string,
  chatId: string,
  content: string,
  arrButton: string[] = [],
) => {
  try {
    let data: any = {
      chat_id: chatId,
      text: content,
    }
    if (arrButton.length > 0) {
      data = {
        ...data,
        reply_markup: {
          keyboard: arrButton.map((btn) => [{ text: btn }]),
        },
      }
    }
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    })
    return true
  } catch (error) {
    console.log('🚀 ~ file: utils.ts:34 ~ error:', error)
    return false
  }
}
