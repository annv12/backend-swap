import { createError } from 'apollo-errors'

export const AuthenticationError = createError('UNAUTHENTICATED', {
  message: 'Authentication error',
  options: { showPath: false, showLocations: false },
})

export const ValidationError = createError('ValidationError', {
  message: 'Validation error',
  options: { showPath: false, showLocations: false },
})

export const TokenTemporaryError = createError('TokenTemporaryError', {
  message: 'TokenTemporaryError error',
  options: { showPath: false, showLocations: false },
})

