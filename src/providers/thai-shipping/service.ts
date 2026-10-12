import { AbstractFulfillmentProviderService, MedusaError } from "@medusajs/framework/utils"
import type {
  CalculatedShippingOptionPrice,
  CalculateShippingOptionPriceDTO,
  CreateFulfillmentResult,
  CreateShippingOptionDTO,
  FulfillmentOption,
  ValidateFulfillmentDataContext,
} from "@medusajs/types"
import { validateThaiAddress } from "../../lib/address"
import {
  CarrierConfig,
  OverweightError,
  calculateShippingPrice,
  trackingUrl,
  validateCarriers,
} from "../../lib/rates"

export type ThaiShippingOptions = {
  carriers: CarrierConfig[]
  /** Unit of `variant.weight` in your catalogue. Defaults to grams. */
  weightUnit?: "g" | "kg"
  /** Reject shipping addresses whose postal code or province is not valid in Thailand. Defaults to true. */
  validateAddress?: boolean
}

type AddressLike = { postal_code?: string | null; province?: string | null; country_code?: string | null } | null | undefined

export class ThaiShippingProviderService extends AbstractFulfillmentProviderService {
  static identifier = "thai-shipping"

  protected readonly options_: ThaiShippingOptions
  protected readonly carriers_: Map<string, CarrierConfig>

  static validateOptions(options: Record<string, unknown>): void | never {
    validateCarriers(options.carriers)
    if (options.weightUnit !== undefined && options.weightUnit !== "g" && options.weightUnit !== "kg") {
      throw new Error('medusa-thai-shipping: `weightUnit` must be "g" or "kg"')
    }
  }

  constructor(container: Record<string, unknown>, options: ThaiShippingOptions) {
    super()
    this.options_ = options
    this.carriers_ = new Map(options.carriers.map((c) => [c.id, c]))
  }

  private carrierFor(optionData: Record<string, unknown>): CarrierConfig {
    const carrier = this.carriers_.get(String(optionData?.id))
    if (!carrier) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `Unknown carrier "${String(optionData?.id)}"`)
    }
    return carrier
  }

  /** Returns the province code when the address is a valid Thai address; throws INVALID_DATA otherwise. */
  private checkAddress(address: AddressLike): number | undefined {
    if (!address) return undefined
    if (address.country_code && address.country_code.toLowerCase() !== "th") {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Thai carriers only deliver within Thailand")
    }
    const result = validateThaiAddress({ postal_code: address.postal_code, province: address.province })
    if (!result.valid) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, result.message)
    }
    return result.province_code
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return [...this.carriers_.values()].map((c) => ({ id: c.id, name: c.name }))
  }

  async canCalculate(_data: CreateShippingOptionDTO): Promise<boolean> {
    return true
  }

  async validateOption(data: Record<string, unknown>): Promise<boolean> {
    return this.carriers_.has(String(data?.id))
  }

  async validateFulfillmentData(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    context: ValidateFulfillmentDataContext
  ): Promise<Record<string, unknown>> {
    const carrier = this.carrierFor(optionData)
    if (this.options_.validateAddress !== false) this.checkAddress(context.shipping_address)
    return { ...data, carrier_id: carrier.id }
  }

  async calculatePrice(
    optionData: CalculateShippingOptionPriceDTO["optionData"],
    _data: CalculateShippingOptionPriceDTO["data"],
    context: CalculateShippingOptionPriceDTO["context"]
  ): Promise<CalculatedShippingOptionPrice> {
    const carrier = this.carrierFor(optionData)
    const perUnit = this.options_.weightUnit === "kg" ? 1000 : 1
    const grams = (context.items ?? []).reduce(
      (sum, item) => sum + (Number(item.variant?.weight) || 0) * perUnit * Number(item.quantity),
      0
    )

    // A bad address blocks checkout in validateFulfillmentData; here we only use it to price remote areas.
    const provinceCode = this.safeProvinceCode(context.shipping_address)

    try {
      return {
        calculated_amount: calculateShippingPrice(carrier, grams, provinceCode),
        is_calculated_price_tax_inclusive: false,
      }
    } catch (e) {
      if (e instanceof OverweightError) throw new MedusaError(MedusaError.Types.INVALID_DATA, e.message)
      throw e
    }
  }

  private safeProvinceCode(address: AddressLike): number | undefined {
    if (!address) return undefined
    const r = validateThaiAddress({ postal_code: address.postal_code, province: address.province })
    return r.valid ? r.province_code : undefined
  }

  /**
   * No carrier API is called. Staff can pass `tracking_number` as additional data when creating the
   * fulfillment (for example after booking the parcel in the carrier's own portal).
   */
  async createFulfillment(
    data: Record<string, unknown>,
    _items: unknown[],
    _order: unknown,
    _fulfillment: unknown,
    additionalData?: Record<string, unknown>
  ): Promise<CreateFulfillmentResult> {
    const carrier = this.carriers_.get(String(data?.carrier_id))
    const tracking = typeof additionalData?.tracking_number === "string" ? additionalData.tracking_number.trim() : ""
    if (!carrier || !tracking) return { data: { ...data }, labels: [] }
    return {
      data: { ...data, tracking_number: tracking },
      labels: [{ tracking_number: tracking, tracking_url: trackingUrl(carrier, tracking), label_url: "" }],
    }
  }

  async cancelFulfillment(): Promise<Record<string, never>> {
    return {}
  }

  async createReturnFulfillment(): Promise<CreateFulfillmentResult> {
    return { data: {}, labels: [] }
  }

  async getFulfillmentDocuments(): Promise<never[]> {
    return []
  }

  async getReturnDocuments(): Promise<never[]> {
    return []
  }

  async getShipmentDocuments(): Promise<never[]> {
    return []
  }
}

export default ThaiShippingProviderService
