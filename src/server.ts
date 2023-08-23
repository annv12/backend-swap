import { GraphQLServer } from 'graphql-yoga'
import { permissions } from './permissions'
import { schema } from './schema'
import { createContext } from './context'
import { ApolloEngine } from 'apollo-engine'
require('dotenv').config()
import { formatError } from 'apollo-errors'
import webhooks from './webhooks'
import Moralis from 'moralis'

const port = parseInt(process.env.PORT, 10) || 4000

webhooks.listen(4001, () => {
  console.log(`🚀 Server listen on PORT 4001`);
});

const server = new GraphQLServer({
  schema,
  context: createContext,
  middlewares: [permissions],
})

const startServer = async () => {
  await Moralis.start({ apiKey: process.env.MORALIS_API_KEY })

  if (process.env.APOLLO_ENGINE_KEY) {
    const engine = new ApolloEngine({
      apiKey: process.env.APOLLO_ENGINE_KEY,
    })
  
    const httpServer = server.createHttpServer({
      tracing: true,
      cacheControl: true,
      uploads: {
        maxFileSize: 5000000,
        maxFiles: 10, // allow upload multiple files in tickets
      },
      formatError,
    })
  
    engine.listen(
      {
        port,
        httpServer,
        graphqlPaths: ['/'],
      },
      () =>
        console.log(
          `🚀 Server with Apollo Engine is running on http://localhost:${port}`,
        ),
    )
  } else {
    server.start(
      {
        port,
        uploads: {
          maxFileSize: 5000000,
          maxFiles: 10,
        },
        formatError,
      },
      () => console.log(`🚀 Server is running on http://localhost:${port}`),
    )
  }
}
startServer()
