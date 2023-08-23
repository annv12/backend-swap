import i18n from 'i18n'
import { Request } from 'express'
i18n.configure({
  locales: [
    'en',
    'vi',
    'de',
    'es',
    'fr',
    'id',
    'jp',
    'ko',
    'nl',
    'pl',
    'pt',
    'ru',
    'tr',
    'zh',
  ],
  directory: __dirname + '/../locales',
  defaultLocale: 'en',
})

export function setLocale(req: Request) {
  // console.log('ctx.request.headers: ', req.request.headers['set-cookie'])
  const requstLanguage = req?.headers?.['accept-language'] || 'en'
  i18n.setLocale(requstLanguage)
  return i18n
}
