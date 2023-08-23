import { objectType } from 'nexus'

export const AuthPayload = objectType({
  name: 'AuthPayload',
  definition(t) {
    t.string('token', { nullable: true })
    t.field('user', { type: 'User' })
    t.boolean('hasTwoFactor', { nullable: true })
  },
})
