import {
  plugin,
  interfaceType,
  FieldResolver,
  nonNull,
  queryField,
  list,
  idArg,
  core,
} from 'nexus'
import { GraphQLResolveInfo } from 'graphql'
import { fromGlobalId, toGlobalId } from 'graphql-relay'

export type RelayNodeInterfacePluginConfig = {
  idFetcher: (
    val: { id: string; type: core.AllOutputTypes },
    ctx: core.GetGen<'context'>,
    info: GraphQLResolveInfo,
  ) => core.ResultValue<any, any>
  // resolveType: (object: core.ResultValue<any, any>) => core.AllOutputTypes
  /**
   * Used to parse the ID before calling idFetcher - By default this calls fromGlobalId from graphql-relay
   */
  idParser?: (id: string) => any
  nonNullDefaults?: core.NonNullConfig
}

export const logMutationTimePlugin = plugin({
  name: 'LogMutationTime',
  onCreateFieldResolver(config) {
    if (config.parentTypeConfig.name !== 'Mutation') {
      return
    }
    return async (root, args, ctx, info, next) => {
      const startTimeMs = new Date().valueOf()
      const value = await next(root, args, ctx, info)
      const endTimeMs = new Date().valueOf()
      console.log(
        `Mutation ${info.operation.name} took ${endTimeMs - startTimeMs} ms`,
      )
      return value
    }
  },
})

export const NodePlugin = (pluginConfig: RelayNodeInterfacePluginConfig) => {
  const {
    idFetcher,
    // resolveType,
    idParser = fromGlobalId,
    nonNullDefaults,
  } = pluginConfig

  if (!idFetcher) {
    throw new Error('idFetcher option is required for relayNodeInterfacePlugin')
  }

  if (typeof idFetcher !== 'function') {
    throw new Error(
      'idFetcher option must be a function with signature: async ({ id, type }, ctx, info) => T where T is the resolved value for the ID',
    )
  }

  // if (!resolveType) {
  //   throw new Error(
  //     'resolveType option is required for relayNodeInterfacePlugin',
  //   )
  // }

  // if (typeof resolveType !== 'function') {
  //   throw new Error(
  //     'resolveType option must be an function with signature async (value) => T where T is the type name or object',
  //   )
  // }

  return plugin({
    name: 'NodePlugin',
    description: 'Allows us to designate the field used to ',
    objectTypeDefTypes: `node?: string | core.FieldResolver<TypeName, any>`,
    // @ts-ignore
    onObjectDefinition(t, { node }) {
      if (node) {
        let resolveFn
        if (typeof node === 'string') {
          const fieldResolve: FieldResolver<any, any> = (
            root,
            args,
            ctx,
            info,
          ) => {
            // return `${info.parentType.name}:${root[node]}`
            if (root[node]) {
              console.log('root[node]', root[node])
              return toGlobalId(info.parentType.name, root[node])
            } else {
              console.log('ARGS: ', args, root, info.fieldName)
              return 'idddd'
            }
          }
          resolveFn = fieldResolve
        } else {
          resolveFn = node
        }
        // @ts-ignore
        t.implements('Node')
        t.field('id', {
          type: nonNull('ID'),
          resolve: resolveFn,
        })
      }
    },
    onMissingType(t, _builder) {
      if (t === 'Node') {
        return interfaceType({
          name: 'Node',
          description:
            'A "Node" is an Object with a required ID field (id), per the https://relay.dev/docs/en/graphql-server-specification',
          resolveType(source) {
            if (source.__typename) {
              return source.__typename
            }

            throw new Error('__typename missing for resolving Node')
          },
          definition(t) {
            t.field('id', {
              type: nonNull('ID'),
              resolve: () => {
                throw new Error('Abstract')
              },
            })
          },
        })
      }
    },
    onInstall(builder) {
      if (!builder.hasType('Node')) {
        // node interface
        // builder.addType(
        //   interfaceType({
        //     name: 'Node',
        //     description: 'An object with a global ID',
        //     definition: (t) => {
        //       ;(nonNullDefaults
        //         ? nonNullDefaults.output
        //           ? t.nonNull
        //           : t.nullable
        //         : t
        //       ).id('id', {
        //         description: 'The global ID of the object.',
        //       })

        //       // overwrite the resolve type with the client function
        //       // resolveType is just one way to map objs -> to the graphql type they represent
        //       //  we could also have simply relied on isTypeOf on the GraphQLObjectType themselves
        //       //  but as relay uses this by default, let's keep using it
        //     },
        //     resolveType,
        //   }),
        // )

        // node field
        builder.addType(
          queryField((t) => {
            t.nullable.field('node', {
              // @ts-ignore
              type: 'Node',
              args: {
                // defaults to nonNull to keep it backward compatible
                id: (nonNullDefaults
                  ? nonNullDefaults.input
                    ? nonNull
                    : (v: any) => v
                  : nonNull)(
                  idArg({
                    description: 'The global ID of an object',
                  }),
                ),
              },
              description: 'Fetches an object given its global ID',
              resolve: (_obj, { id }, ctx, info) => {
                // @ts-ignore
                const data = idFetcher(idParser(id), ctx, info)
                return data
              },
            })
          }) as core.NexusExtendTypeDef<string>,
        )

        // nodes field
        builder.addType(
          queryField((t) => {
            t.nonNull.list.field('nodes', {
              // @ts-ignore
              type: 'Node',
              args: {
                ids: nonNull(
                  list(
                    nonNull(
                      idArg({
                        description: 'The global IDs of objects',
                      }),
                    ),
                  ),
                ),
              },
              description: 'Fetches objects given their global IDs',
              resolve: (_obj, { ids }, ctx, info) =>
                Promise.all(
                  ids.map((id) =>
                    Promise.resolve(idFetcher(idParser(id), ctx, info)),
                  ),
                ),
            })
          }) as core.NexusExtendTypeDef<string>,
        )
      }
    },
  })
}
