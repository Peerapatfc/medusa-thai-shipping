import { describe, expect, it } from "vitest"
import { lookupPostalCode, normalizeProvince, validateThaiAddress } from "../src/lib/address"
import { CarrierConfig, calculateShippingPrice, trackingUrl, validateCarriers } from "../src/lib/rates"
import { ThaiShippingProviderService } from "../src/providers/thai-shipping/service"

// Sample numbers for tests only. They are not any carrier's real price list.
const flash: CarrierConfig = {
  id: "flash",
  name: "Flash Express",
  rates: [
    { maxWeightGrams: 1000, price: 40 },
    { maxWeightGrams: 5000, price: 70 },
    { maxWeightGrams: 20000, price: 150 },
  ],
  remoteSurcharge: { provinceCodes: [94, 95, 96], amount: 30 }, // Pattani, Yala, Narathiwat
  trackingUrlTemplate: "https://track.example/{tracking}",
}
const post: CarrierConfig = { id: "post", name: "Thailand Post", rates: [{ maxWeightGrams: 2000, price: 32.5 }] }

function service(extra: Record<string, unknown> = {}) {
  return new ThaiShippingProviderService({}, { carriers: [flash, post], ...extra })
}

function ctx(items: Array<{ weight: number | null; quantity: number }>, address?: Record<string, unknown> | null) {
  return {
    id: "cart_1",
    shipping_address: address === undefined ? { postal_code: "10110", province: "กรุงเทพมหานคร", country_code: "th" } : address,
    items: items.map((i, n) => ({ id: `item_${n}`, quantity: i.quantity, variant: { id: `v_${n}`, weight: i.weight } })),
  } as any
}

describe("address data", () => {
  it("looks up a real postal code", () => {
    const m = lookupPostalCode("10110")
    expect(m.length).toBeGreaterThan(0)
    expect(m.every((x) => x.province_en === "Bangkok")).toBe(true)
  })
  it("accepts numeric input and rejects malformed codes", () => {
    expect(lookupPostalCode(10110).length).toBeGreaterThan(0)
    expect(lookupPostalCode("1011")).toEqual([])
    expect(lookupPostalCode("abcde")).toEqual([])
  })
  it("has all 77 provinces", () => {
    const provinces = new Set<number>()
    for (let c = 10000; c <= 96999; c++) lookupPostalCode(c).forEach((m) => provinces.add(m.province_code))
    expect(provinces.size).toBe(77)
  })
})

describe("validateThaiAddress", () => {
  it.each(["กรุงเทพมหานคร", "กรุงเทพ", "กรุงเทพฯ", "กทม.", "Bangkok", "จังหวัดกรุงเทพมหานคร", " bangkok "])(
    "accepts %s for a Bangkok postcode",
    (province) => {
      const r = validateThaiAddress({ postal_code: "10110", province })
      expect(r.valid).toBe(true)
    }
  )
  it("accepts a postcode with no province", () => {
    const r = validateThaiAddress({ postal_code: "10110" })
    expect(r.valid && r.province_code).toBe(10)
  })
  it("reports province mismatch with the expected province", () => {
    const r = validateThaiAddress({ postal_code: "10110", province: "เชียงใหม่" })
    expect(r).toMatchObject({ valid: false, reason: "province_mismatch" })
    expect(!r.valid && r.message).toContain("กรุงเทพมหานคร")
  })
  it("rejects unknown and malformed postal codes", () => {
    expect(validateThaiAddress({ postal_code: "00000" })).toMatchObject({ valid: false, reason: "unknown_postal_code" })
    expect(validateThaiAddress({ postal_code: "12" })).toMatchObject({ valid: false, reason: "invalid_postal_code" })
    expect(validateThaiAddress({})).toMatchObject({ valid: false, reason: "invalid_postal_code" })
  })
  it("normalizes province strings", () => {
    expect(normalizeProvince("จ.เชียงใหม่")).toBe("เชียงใหม่")
    expect(normalizeProvince("Chiang Mai Province")).toBe("chiangmai")
  })
})

describe("rates", () => {
  it("picks the first band that fits, inclusive of the upper bound", () => {
    expect(calculateShippingPrice(flash, 0)).toBe(40)
    expect(calculateShippingPrice(flash, 1000)).toBe(40)
    expect(calculateShippingPrice(flash, 1001)).toBe(70)
    expect(calculateShippingPrice(flash, 20000)).toBe(150)
  })
  it("rounds fractional grams up and rejects overweight parcels", () => {
    expect(calculateShippingPrice(flash, 1000.2)).toBe(70)
    expect(() => calculateShippingPrice(flash, 20001)).toThrow(/maximum 20000 g/)
  })
  it("adds the remote surcharge only for listed provinces", () => {
    expect(calculateShippingPrice(flash, 500, 94)).toBe(70)
    expect(calculateShippingPrice(flash, 500, 10)).toBe(40)
  })
  it("keeps satang precision", () => {
    expect(calculateShippingPrice(post, 100)).toBe(32.5)
  })
  it("builds tracking URLs", () => {
    expect(trackingUrl(flash, "TH 123")).toBe("https://track.example/TH%20123")
    expect(trackingUrl(post, "X")).toBe("")
  })
  it("validates carrier config", () => {
    expect(() => validateCarriers([])).toThrow()
    expect(() => validateCarriers([flash, flash])).toThrow(/duplicate/)
    expect(() => validateCarriers([{ id: "a", name: "A", rates: [{ maxWeightGrams: 100, price: 1 }, { maxWeightGrams: 50, price: 2 }] }])).toThrow(/increasing/)
    expect(() => validateCarriers([{ id: "a", name: "A", rates: [{ maxWeightGrams: 100, price: -1 }] }])).toThrow(/negative/)
    expect(() => validateCarriers([flash, post])).not.toThrow()
  })
})

describe("ThaiShippingProviderService", () => {
  it("rejects bad options", () => {
    expect(() => ThaiShippingProviderService.validateOptions({})).toThrow()
    expect(() => ThaiShippingProviderService.validateOptions({ carriers: [flash], weightUnit: "lb" })).toThrow(/weightUnit/)
    expect(() => ThaiShippingProviderService.validateOptions({ carriers: [flash] })).not.toThrow()
  })

  it("lists one fulfillment option per carrier", async () => {
    expect(await service().getFulfillmentOptions()).toEqual([
      { id: "flash", name: "Flash Express" },
      { id: "post", name: "Thailand Post" },
    ])
    expect(await service().validateOption({ id: "flash" })).toBe(true)
    expect(await service().validateOption({ id: "nope" })).toBe(false)
  })

  it("prices by total cart weight", async () => {
    const out = await service().calculatePrice({ id: "flash" }, {}, ctx([{ weight: 400, quantity: 2 }, { weight: 300, quantity: 1 }]))
    expect(out).toEqual({ calculated_amount: 70, is_calculated_price_tax_inclusive: false }) // 1100 g
  })

  it("supports kilogram catalogues and missing weights", async () => {
    const s = service({ weightUnit: "kg" })
    expect((await s.calculatePrice({ id: "flash" }, {}, ctx([{ weight: 1.5, quantity: 1 }]))).calculated_amount).toBe(70)
    expect((await service().calculatePrice({ id: "flash" }, {}, ctx([{ weight: null, quantity: 3 }]))).calculated_amount).toBe(40)
  })

  it("adds the remote surcharge from the shipping address", async () => {
    const remote = ctx([{ weight: 500, quantity: 1 }], { postal_code: "94000", province: "ปัตตานี", country_code: "th" })
    expect(lookupPostalCode("94000")[0].province_code).toBe(94)
    expect((await service().calculatePrice({ id: "flash" }, {}, remote)).calculated_amount).toBe(70)
  })

  it("still prices when there is no address yet", async () => {
    expect((await service().calculatePrice({ id: "flash" }, {}, ctx([{ weight: 500, quantity: 1 }], null))).calculated_amount).toBe(40)
  })

  it("fails clearly for overweight carts and unknown carriers", async () => {
    await expect(service().calculatePrice({ id: "post" }, {}, ctx([{ weight: 2500, quantity: 1 }]))).rejects.toThrow(/maximum 2000 g/)
    await expect(service().calculatePrice({ id: "zzz" }, {}, ctx([]))).rejects.toThrow(/Unknown carrier/)
  })

  describe("validateFulfillmentData", () => {
    it("stores the carrier id for a valid address", async () => {
      const out = await service().validateFulfillmentData({ id: "flash" }, { note: "x" }, ctx([]) as any)
      expect(out).toEqual({ note: "x", carrier_id: "flash" })
    })
    it("blocks checkout on a province/postcode mismatch", async () => {
      const bad = ctx([], { postal_code: "10110", province: "ภูเก็ต", country_code: "th" })
      await expect(service().validateFulfillmentData({ id: "flash" }, {}, bad)).rejects.toThrow(/belongs to/)
    })
    it("blocks non-Thai destinations", async () => {
      const bad = ctx([], { postal_code: "10110", province: "Bangkok", country_code: "sg" })
      await expect(service().validateFulfillmentData({ id: "flash" }, {}, bad)).rejects.toThrow(/within Thailand/)
    })
    it("can skip address validation", async () => {
      const bad = ctx([], { postal_code: "00000", province: "x", country_code: "th" })
      await expect(service({ validateAddress: false }).validateFulfillmentData({ id: "flash" }, {}, bad)).resolves.toBeTruthy()
    })
  })

  describe("createFulfillment", () => {
    it("returns a tracking label when staff supply a tracking number", async () => {
      const out = await service().createFulfillment({ carrier_id: "flash" }, [], undefined, {}, { tracking_number: " TH123 " })
      expect(out.data).toMatchObject({ tracking_number: "TH123" })
      expect(out.labels).toEqual([{ tracking_number: "TH123", tracking_url: "https://track.example/TH123", label_url: "" }])
    })
    it("returns no labels without a tracking number", async () => {
      const out = await service().createFulfillment({ carrier_id: "flash" }, [], undefined, {})
      expect(out.labels).toEqual([])
    })
  })
})
