import fs from 'fs'
import path from 'path'
import DeviceDetector from 'device-detector-js'
import geoip from 'geoip-lite'
import { Request } from 'express'
import { format } from 'date-fns'
import { ValidationError } from './error-util'
const mailgun = require('mailgun-js')

async function readEmailContent(
  filePath: string,
  replaces: Map<string, string>,
): Promise<string> {
  return new Promise(function (resolve, reject) {
    fs.readFile(path.resolve(filePath), 'utf8', (err, data) => {
      if (err) {
        console.error(err)
        reject(err)
      }
      if (!replaces || !data) {
        resolve(data)
        return
      }
      replaces.forEach(function (value, key) {
        data = data.replace(key, value)
      })
      resolve(data)
    })
  })
}
// replace var is collection key, value to set into html string with {{}}
export async function sendMail(
  to: string,
  subject: string,
  filePath: string,
  replaces: Map<string, string>,
) {
  if (!to || !subject) {
    throw new ValidationError({ message: 'Not found address or subject' })
  }
  // default content
  let replaceMap = new Map()
  replaceMap.set(
    '{{official_page}}',
    process.env.OFFICIAL_PAGE ?? 'https://voption.org',
  )
  replaceMap.set(
    '{{official_logo_png}}',
    `${process.env.OFFICIAL_PAGE}/images/logo.png`,
  )

  replaceMap.set('{{facebook_link}}', 'https://www.facebook.com/')
  replaceMap.set(
    '{{facebook_png}}',
    `${process.env.OFFICIAL_PAGE}/images/facebook.png`,
  )
  replaceMap.set('{{twitter_link}}', 'https://twitter.com/')
  replaceMap.set(
    '{{twitter_png}}',
    `${process.env.OFFICIAL_PAGE}/images/twitter.png`,
  )
  replaceMap.set('{{telegram_link}}', 'https://t.me/')
  replaceMap.set(
    '{{telegram_png}}',
    `${process.env.OFFICIAL_PAGE}/images/telegram.png`,
  )
  replaces.forEach(function (value, key) {
    replaceMap.set(key, value)
  })
  let content = await readEmailContent(filePath, replaceMap)

  const mg = mailgun({
    apiKey: process.env.MAILGUN_API_KEY,
    domain: process.env.MAILGUN_DOMAIN,
  })

  try {
    const result = await mg.messages().send({
      from: 'Voption <no-reply@voption.org>',
      to: to,
      subject: subject,
      html: content,
    }, function (error: any, body: any) {
      console.log(body, error);
    })
    return result
  } catch (error) {
    console.error('Send mail failed', error)
    // throw new ValidationError({ message: 'Send mail failed' })
  }
}
export async function sendDepositSucceededMail(
  to: string,
  username: string,
  currency: string,
  address: string,
  hash: string,
  quantity: number,
  status: string,
  time: string,
) {
  let replaces = new Map()
  replaces.set('{{username}}', username)

  replaces.set('{{currency}}', currency)
  replaces.set('{{address}}', address)
  replaces.set('{{hash}}', hash)
  replaces.set('{{quantity}}', quantity)
  replaces.set('{{status}}', status)
  replaces.set('{{time}}', time)
  let result = await sendMail(
    to,
    '[voption.org] Deposit Succeeded',
    './public/deposit.html',
    replaces,
  )
  // console.log('result: ', result)
  return result
}
export async function sendWithdrawSucceededMail(
  to: string,
  username: string,
  currency: string,
  address: string,
  hash: string,
  quantity: number,
  status: string,
  time: string,
) {
  let replaces = new Map()
  replaces.set('{{username}}', username)
  replaces.set('{{currency}}', currency)
  replaces.set('{{address}}', address)
  replaces.set('{{hash}}', hash)
  replaces.set('{{quantity}}', quantity)
  replaces.set('{{status}}', status)
  replaces.set('{{time}}', time)
  let result = await sendMail(
    to,
    '[voption.org] Withdrawal Succeeded',
    './public/withdraw_success.html',
    replaces,
  )
  // console.log('result: ', result)
  return result
}
export async function sendWithdrawFailedMail(
  to: string,
  username: string,
  currency: string,
  address: string,
  quantity: number,
  status: string,
  time: string,
) {
  let replaces = new Map()
  replaces.set('{{username}}', username)
  replaces.set('{{currency}}', currency)
  replaces.set('{{address}}', address)
  replaces.set('{{quantity}}', quantity)
  replaces.set('{{status}}', status)
  replaces.set('{{time}}', time)
  let result = await sendMail(
    to,
    '[voption.org] Withdrawal Failed',
    './public/withdraw_failed.html',
    replaces,
  )
  // console.log('result: ', result)
  return result
}
export async function sendAgencyLicenseMail(
  to: string,
  username: string,
  linkRef: string,
) {
  let replaces = new Map()
  replaces.set('{{username}}', username)
  replaces.set('{{linkRef}}', linkRef)

  let result = await sendMail(
    to,
    `[voption.org] Agency License successfully purchased`,
    './public/agency_purchased.html',
    replaces,
  )
  // console.log('result: ', result)
  return result
}
export async function sendLoginMail(
  to: string,
  username: string,
  request: Request,
) {
  var ipAddress: string = request?.ip ?? ''
  var userAgent = request?.headers['user-agent'] ?? ''

  let replaces = new Map()
  replaces.set('{{username}}', username)
  replaces.set('{{ipAddress}}', ipAddress)

  let device = ''
  replaces.set('{{time}}', format(new Date(), 'zzzz HH:mm dd/MM/yyyy'))
  if (userAgent) {
    const deviceDetector = new DeviceDetector()
    const deviceInfo = deviceDetector.parse(userAgent)
    // console.log(deviceInfo)
    if (deviceInfo && deviceInfo.os) {
      device = `${deviceInfo.os?.name ?? ''} ${deviceInfo.os?.version ?? ''}, ${
        deviceInfo.device?.brand
      } ${
        deviceInfo.device?.model && deviceInfo.device.model != ''
          ? deviceInfo.device.model
          : deviceInfo.os?.name ?? ''
      }`
    }
  }
  replaces.set('{{device}}', device)

  let location = ''
  if (ipAddress) {
    var geo = geoip.lookup(ipAddress)
    if (geo) {
      location = `${geo.city}, ${geo.country}`
    }
  }
  replaces.set('{{location}}', location)
  let result = await sendMail(
    to,
    `[voption.org] New Login Notice`,
    './public/login.html',
    replaces,
  )
  // console.log('result: ', result)
  return result
}

export async function sendForgotMail(
  to: string,
  username: string,
  forgotLink: string,
) {
  let replaces = new Map()
  replaces.set('{{username}}', username)
  replaces.set('{{reset_password_link}}', forgotLink)
  replaces.set(
    '{{reset_password_button_png}}',
    `${process.env.OFFICIAL_PAGE}/images/reset_button.png`,
  )
  let result = await sendMail(
    to,
    '[voption.org] Password Recovery',
    './public/forgot_password.html',
    replaces,
  )
  // console.log('result: ', result)
  return result
}

export async function sendVerifyMail(
  to: string,
  username: string,
  activationLink: string,
) {
  let replaces = new Map()
  replaces.set('{{username}}', username)
  replaces.set('{{activation_link}}', activationLink)
  replaces.set(
    '{{activation_button_png}}',
    `${process.env.OFFICIAL_PAGE}/images/active_button.png`,
  )

  let result = await sendMail(
    to,
    '[voption.org] Verify email',
    './public/account_verification.html',
    replaces,
  )
  // console.log('result: ', result)
  return result
}

export async function sendReactiveMail(to: string, username: string) {
  let replaces = new Map()
  replaces.set('{{username}}', username)

  let result = await sendMail(
    to,
    `[voption.org] Re-activate account notice`,
    './public/reactive.html',
    replaces,
  )
  // console.log('result: ', result)
  return result
}
