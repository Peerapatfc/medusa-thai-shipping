export type WeightBand = {
  /** Upper bound of the band, inclusive, in grams. */
  maxWeightGrams: number
  /** Price in THB (major units) for a parcel up to this weight. */
  price: number
}

export type CarrierConfig = {
  /** Unique id, becomes the fulfillment option id (e.g. "flash"). */
  id: string
  /** Display name (e.g. "Flash Express"). */
  name: string
  rates: WeightBand[]
  /** Extra charge for destinations in these province codes (e.g. remote areas). */
  remoteSurcharge?: { provinceCodes: number[]; amount: number }
  /** Tracking page template; `{tracking}` is replaced with the tracking number. */
  trackingUrlTemplate?: string
}

export function validateCarriers(carriers: unknown): asserts carriers is CarrierConfig[] {
  if (!Array.isArray(carriers) || carriers.length === 0) {
    throw new Error("medusa-thai-shipping: option `carriers` must be a non-empty array")
  }
  const seen = new Set<string>()
  for (const c of carriers as CarrierConfig[]) {
    if (!c?.id || !c?.name) throw new Error("medusa-thai-shipping: every carrier needs `id` and `name`")
    if (seen.has(c.id)) throw new Error(`medusa-thai-shipping: duplicate carrier id "${c.id}"`)
    seen.add(c.id)
    if (!Array.isArray(c.rates) || c.rates.length === 0) {
      throw new Error(`medusa-thai-shipping: carrier "${c.id}" needs at least one rate band`)
    }
    let prev = 0
    for (const band of c.rates) {
      if (!(band.maxWeightGrams > prev)) {
        throw new Error(`medusa-thai-shipping: carrier "${c.id}" rate bands must have strictly increasing maxWeightGrams`)
      }
      if (!(band.price >= 0)) throw new Error(`medusa-thai-shipping: carrier "${c.id}" has a negative price`)
      prev = band.maxWeightGrams
    }
  }
}

export class OverweightError extends Error {
  constructor(carrier: string, weightGrams: number, maxGrams: number) {
    super(`${carrier} cannot ship ${weightGrams} g (maximum ${maxGrams} g)`)
    this.name = "OverweightError"
  }
}

export function calculateShippingPrice(carrier: CarrierConfig, weightGrams: number, provinceCode?: number): number {
  const weight = Math.max(0, Math.ceil(weightGrams))
  const band = carrier.rates.find((b) => weight <= b.maxWeightGrams)
  if (!band) {
    throw new OverweightError(carrier.name, weight, carrier.rates[carrier.rates.length - 1].maxWeightGrams)
  }
  const surcharge =
    provinceCode !== undefined && carrier.remoteSurcharge?.provinceCodes.includes(provinceCode)
      ? carrier.remoteSurcharge.amount
      : 0
  return Math.round((band.price + surcharge) * 100) / 100
}

export function trackingUrl(carrier: CarrierConfig, trackingNumber: string): string {
  return carrier.trackingUrlTemplate?.replace("{tracking}", encodeURIComponent(trackingNumber)) ?? ""
}
