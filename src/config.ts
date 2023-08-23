export type Config = {
  priceConfigableCurrencies: Set<string>
}

export const config: Config = {
  priceConfigableCurrencies: new Set(['BDF', 'TBR']),
}

export default config
