import { extendType, stringArg } from 'nexus'
import fetch from 'node-fetch'
import logger from '../../lib/logger'

const BLACKBOX_URL = process.env.BLACKBOX_URL

export const blackboxMutation = extendType({
  type: 'Mutation',
  definition: (t) => {
    t.field('manualSet', {
      type: 'Boolean',
      args: {
        overwriteResult: stringArg({ required: true }),
      },
      resolve: async (_, { overwriteResult }) => {
        const request = await fetch(`${BLACKBOX_URL}/api/v1/in/overwrite/`, {
          method: 'POST',
          headers: {
            token: '57Ai8eICfsQ57Ai8eICfsQ',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ overwrite_result: overwriteResult }),
        })

        if (!request.ok) {
          const json = await request.json()
          logger.warning(`Send withdraw request failed`, json)
          // @ts-ignore
          throw new ValidationError({ message: json.message })
        }

        const data = await request.json()
        logger.info('Sent Order To BlackBox', data)
        return true
      },
    })
  },
})
