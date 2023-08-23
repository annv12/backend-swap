import { PrismaClient, UserRole } from '@prisma/client'
import express from 'express'
import logger from '../lib/logger'
import jwt from '../lib/jwt'

const prisma = new PrismaClient()

const app = express()
const port = process.env.PORT || 4000

app.get('/', (req, res) => {
  res.send('Webhooks are running')
})

app.get('/verify-token', async (request, response) => {
  type Token = {
    userId: string
    role?: UserRole
  }

  const Authorization = request.get('Authorization')

  if (Authorization) {
    const token = Authorization.replace('Bearer ', '')
    logger.info(`Token found: ${token}`)

    const verifiedToken = jwt.verify(token) as Token
    if (!verifiedToken) {
      logger.error(`Token invalid`)
      return response.status(401).json({
        message: 'JWT invalid',
      })
    }

    const user = await prisma.user.findUnique({
      where: {
        id: verifiedToken.userId,
      },
    })
    logger.info(`Found user ${user.username}`, user)

    const hasuraVariables = {
      'X-Hasura-Role': user.role?.toLowerCase(),
      'X-Hasura-User-Id': String(user.id),
      'Cache-Control': 'max-age=3600',
    }
    response.json(hasuraVariables)
  } else {
    logger.warn(`Token not found`)
    const hasuraVariables = {
      'X-Hasura-Role': 'guest',
      'X-Hasura-User-Id': '0',
    }
    response.json(hasuraVariables)
  }
})

app.listen(port, function () {
  console.log('🚀 Auth server listen on port: ' + port)
})
