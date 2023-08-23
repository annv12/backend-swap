import winston from 'winston'

const myformat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.align(),
  winston.format.printf(({ timestamp, level, message, ...rest }) => {
    return `${timestamp} ${level}: ${message} ${JSON.stringify({ ...rest })}`
  }),
)

export const logger = winston.createLogger({
  transports: [
    new winston.transports.Console({
      format: myformat,
      level: 'debug',
    }),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
})

// if (process.env.NODE_ENV !== 'production') {
//   logger.add(
//     new winston.transports.Console({
//       format: myformat,
//       level: 'debug',
//     }),
//   )
//   logger.add(new winston.transports.File({ filename: 'combined.log' }))
// }

export default logger
