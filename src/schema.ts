import {
  connectionPlugin,
  declarativeWrappingPlugin,
  makeSchema,
  queryComplexityPlugin,
} from 'nexus'
import * as types from './types'
import { nexusPrisma } from 'nexus-plugin-prisma'
import { logMutationTimePlugin, NodePlugin } from './nexus-plugin'

const DEBUGGING_CURSOR = true

let fn = DEBUGGING_CURSOR ? (i: string) => i : undefined

export const schema = makeSchema({
  types,
  plugins: [
    declarativeWrappingPlugin(),
    NodePlugin({
      idFetcher: async ({ id, type }, ctx) => {
        let data = await ctx.prisma.user.findUnique({ where: { id } })
        if (data) {
          // @ts-ignore
          data['__typename'] = type
          return data
        } else {
          return
        }
      },
    }),
    logMutationTimePlugin,
    queryComplexityPlugin(),
    nexusPrisma({ experimentalCRUD: true }),
    connectionPlugin({
      extendConnection: {
        totalCount: { type: 'Int' },
      },
      includeNodesField: true,
      strictArgs: true,
      cursorFromNode(node) {
        return node.id
      },
      encodeCursor: fn,
      decodeCursor: fn,
    }),
  ],
  outputs: {
    schema: __dirname + '/../schema.graphql',
    typegen: __dirname + '/generated/nexus.ts',
  },
  contextType: {
    module: require.resolve('./context'),
    export: 'Context',
  },
  sourceTypes: {
    modules: [
      {
        module: '@prisma/client',
        alias: 'prisma',
      },
    ],
  },
  features: {
    abstractTypeStrategies: {
      __typename: true,
      resolveType: true,
    },
  },
})
