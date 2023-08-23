import { objectType, scalarType } from 'nexus'
import { GraphQLError } from 'graphql'
import * as FileType from 'file-type'

export const UploadFile = objectType({
  name: 'UploadFile',
  definition(t) {
    t.string('uri')
    t.string('filename')
  },
})

export const Upload = scalarType({
  name: 'Upload',
  asNexusMethod: 'upload', // We set this to be used as a method later as `t.upload()` if needed
  description: 'desc',
  serialize: () => {
    throw new GraphQLError('Upload serialization unsupported.')
  },
  parseValue: async (value) => {
    const upload = await value
    const stream = upload.createReadStream()
    const fileType = await FileType.fromStream(stream)

    if (fileType?.mime !== upload.mimetype)
      throw new GraphQLError('Mime type does not match file content.')

    return upload
  },
  parseLiteral: (ast) => {
    throw new GraphQLError('Upload literal unsupported.', ast)
  },
})
