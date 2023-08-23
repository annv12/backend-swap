import { objectType } from 'nexus'

export const Period = objectType({
  name: 'ExchangePeriod',
  definition: (t) => {
    t.model.id()
    t.model.createdAt()
    t.model.updatedAt()
    t.model.name()
    t.model.period()
  },
})
