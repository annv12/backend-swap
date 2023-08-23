import { objectType, queryType, extendType } from 'nexus'

export const Country = objectType({
  name: 'Country',
  definition(t) {
    t.model.id()
    t.model.name()
    t.model.code()
  },
})

export const countryQuery = extendType({
  type: 'Query',
  definition: (t) => {
    t.list.field('countries', {
      type: Country,
      resolve: async (_, args, ctx) => {
        const res = await ctx.prisma.country.findMany()
        return res
      },
    })
  },
})
