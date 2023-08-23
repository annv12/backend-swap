import * as aws from 'aws-sdk'
import FileType from 'file-type'
import { ValidationError } from './error-util'

export const uploadFile = async (createReadStream: any, filename: any) => {
  // aws.config.update({
  //   region: 'us-east-1',
  //   accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  //   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  // })

  // // Create S3 service object
  // const s3 = new aws.S3({ apiVersion: '2006-03-01' })
  if (
    !process.env.S3_ENDPOINT ||
    !process.env.S3_KEY ||
    !process.env.S3_SECRET ||
    !process.env.S3_BUCKET
  ) {
    throw new ValidationError({ message: 'Missing S3 ENV' })
  }

  const s3 = new aws.S3({
    endpoint: process.env.S3_ENDPOINT,
    accessKeyId: process.env.S3_KEY,
    secretAccessKey: process.env.S3_SECRET,
  })

  const { Location } = await s3
    .upload({
      Body: createReadStream(),
      Key: `${filename}`,
      Bucket: process.env.S3_BUCKET as string,
      ACL: 'public-read',
    })
    .promise()

  console.log(Location)

  return Location
}

export async function validateFileTypeFromStream(createReadStream: any) {
  const allow = ['jpg', 'jpeg', 'png']
  const fileType = await FileType.fromStream(createReadStream())

  if (!fileType || allow.indexOf(fileType.ext) === -1) {
    throw new ValidationError({ message: 'file type not allow' })
  } else {
    return true
  }
}

export async function validateTicketFileFromStream(createReadStream: any) {
  const allow = ['image', 'video']
  const fileType = await FileType.fromStream(createReadStream())

  if (!fileType || allow.every((item) => !fileType.mime.includes(item))) {
    throw new ValidationError({ message: 'File type not allow' })
  } else {
    return true
  }
}
