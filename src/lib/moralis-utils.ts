import Moralis from 'moralis-v1/node'

const serverUrl =
  process.env.MORALIS_SERVER_URL ||
  'https://6swmpkvjtsnn.grandmoralis.com:2053/server'
const appId =
  process.env.MORALIS_APP_ID || 'QtzqqOdIUvdfKjVeGJUR9g1FKk9AHlQojpmOaQwP'
const masterKey =
  process.env.MORALIS_MASTER_KEY || 'cGesMYlxsDQhmU83L04tmNN9PVFwmuIYz3GfQxYu'

export async function watchBscAddress(address: string) {
  await Moralis.start({ serverUrl, appId, masterKey })
  try {
    const results = await Moralis.Cloud.run(
      'watchBscAddress',
      {
        address,
        sync_historical: true,
      },
      { useMasterKey: true },
    )
    console.log(
      '🚀 ~ file: moralis-utils.ts ~ line 22 ~ watchBscAddress ~ results',
      results,
    )
    // if (!results?.data?.success) {
    //   throw new Error('Failed to watch address on Moralis')
    // }
  } catch (error) {
    throw new Error('Failed to watch address on Moralis')
  }
}

export async function watchAddress(address: string, chainPrefix: string) {
  await Moralis.start({ serverUrl, appId, masterKey })
  try {
    const results = await Moralis.Cloud.run(
      `watch${chainPrefix}Address`,
      {
        address,
        sync_historical: true,
      },
      { useMasterKey: true },
    )
    console.log(
      '🚀 ~ file: moralis-utils.ts ~ line 45 ~ watchAddress ~ results',
      results,
    )
  } catch (error) {
    throw new Error(
      `Failed to watch address on Moralis with chain ${chainPrefix}`,
    )
  }
}

export async function getBscTransactionIndex(address: string) {
  await Moralis.start({ serverUrl, appId, masterKey })

  const BscTokenTransfer = Moralis.Object.extend('BscTokenTransfers')
  const query = new Moralis.Query(BscTokenTransfer)
  query.equalTo('from_address', address.toLowerCase())
  query.descending('transaction_index')
  query.limit(1)
  try {
    const results = await query.find()
    if (results.length > 0) {
      return results[0].get('transaction_index')
    }
    return 0
  }
  catch (error) {
    throw new Error('Failed to get Bsc Transaction Index')
  }
}
