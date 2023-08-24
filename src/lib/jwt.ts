import jwt from 'jsonwebtoken'

const privateKey = process.env.JWT_SECRET_KEY
const publicKey = process.env.JWT_PUBLIC_KEY

const i = 'Swap Token' // Issuer
const s = 'admin@swaptoken.org' // Subject
const a = 'https://swaptoken.org' // Audience

export function sign(
  payload: string | object | Buffer,
  expiresTime: string = '15d',
) {
  const signOptions: jwt.SignOptions = {
    issuer: i,
    subject: s,
    audience: a,
    expiresIn: expiresTime,
    algorithm: 'RS256',
  }

  const token = jwt.sign(payload, privateKey, signOptions)

  return token
}

export function verify(token: string) {
  const verifyOptions: jwt.VerifyOptions = {
    issuer: i,
    subject: s,
    audience: a,
    algorithms: ['RS256'],
  }
  const legit = jwt.verify(token, publicKey, verifyOptions)

  return legit
}

export default { sign, verify, decode: jwt.decode }
