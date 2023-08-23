import express from 'express'
import { webhookBscTokenTransfersRouter } from './webhooks/webhook.route'

const app = express()

app.use(express.urlencoded({ extended: true }))
app.use(express.json())

app.use('/', webhookBscTokenTransfersRouter())

export default app
