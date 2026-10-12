# medusa-thai-shipping

Thai shipping for [Medusa v2](https://docs.medusajs.com): weight-band carrier rates and Thai address validation, as a fulfillment provider.

## What it does

- **Carrier rates from weight bands you define.** One fulfillment option per carrier (Flash, Kerry, Thailand Post, or anything else you name). Price is picked from the cart's total weight, plus an optional surcharge for remote provinces.
- **Real Thai address validation.** Checkout is blocked when the postal code does not exist, or when the province disagrees with the postal code. Accepts Thai or English province names and common spellings (`กรุงเทพ`, `กทม.`, `จ.เชียงใหม่`, `Bangkok`).
- **Postal code lookup** helper for storefront autocomplete, backed by all 77 provinces and 7,436 sub-districts.
- **Tracking links.** Staff add a tracking number when they create the fulfillment and the customer gets a carrier tracking URL.

## What it does not do

It does **not** call carrier APIs: no live quotes, no booking, no label printing. Flash Express, Kerry and Thailand Post APIs require a merchant account and private documentation, so this package works from rate tables you copy from your own carrier contract. If you have API access and want a real integration, the provider is a normal Medusa fulfillment provider and `createFulfillment` is the place to call it.

The prices in this README are **examples**, not any carrier's price list.

## Install

```bash
npm install medusa-thai-shipping
```

## Configure

In `medusa-config.ts`:

```ts
module.exports = defineConfig({
  modules: [
    {
      resolve: "@medusajs/medusa/fulfillment",
      options: {
        providers: [
          {
            resolve: "medusa-thai-shipping/providers/thai-shipping",
            id: "thai",
            options: {
              weightUnit: "g", // unit of variant.weight in your catalogue: "g" (default) or "kg"
              carriers: [
                {
                  id: "flash",
                  name: "Flash Express",
                  rates: [
                    { maxWeightGrams: 1000, price: 40 },
                    { maxWeightGrams: 5000, price: 70 },
                    { maxWeightGrams: 20000, price: 150 },
                  ],
                  remoteSurcharge: { provinceCodes: [94, 95, 96], amount: 30 },
                  trackingUrlTemplate: "https://example.com/track/{tracking}",
                },
                {
                  id: "post",
                  name: "Thailand Post",
                  rates: [{ maxWeightGrams: 2000, price: 32.5 }],
                },
              ],
            },
          },
        ],
      },
    },
  ],
})
```

Then, in Medusa Admin, create shipping options with the **Calculated** price type, choose the fulfillment option (`thai-shipping_thai`) and pick a carrier.

| Option | Meaning |
|---|---|
| `carriers[].rates` | Weight bands in ascending order. A parcel pays the first band it fits in (upper bound inclusive). Heavier than the last band is rejected. |
| `carriers[].remoteSurcharge` | Extra THB for destinations in these province codes (official province codes: 10 Bangkok, 94 Pattani, 95 Yala, 96 Narathiwat, ...). |
| `carriers[].trackingUrlTemplate` | `{tracking}` is replaced with the tracking number. |
| `weightUnit` | `g` (default) or `kg`. Missing weights count as 0. |
| `validateAddress` | Set `false` to skip the address check. Default `true`. |

## Storefront: get the price

Medusa does not return prices for **calculated** options in the shipping option list. Ask for each option's price:

```ts
const { shipping_options } = await sdk.store.fulfillment.listCartOptions({ cart_id })
const priced = await Promise.all(
  shipping_options.map((o) => sdk.store.fulfillment.calculate(o.id, { cart_id }))
)
// priced[i].shipping_option.amount, e.g. 40 or 32.5
```

(REST: `POST /store/shipping-options/:id/calculate` with `{ "cart_id": "..." }`.) Choosing a shipping method then runs the address check, and an invalid postal code or a province that does not match it is rejected with a clear message.

## Address helpers

```ts
import { lookupPostalCode, validateThaiAddress } from "medusa-thai-shipping"

lookupPostalCode("50200")
// [{ postal_code: "50200", province_th: "เชียงใหม่", district_th: "...", subdistrict_th: "...", ... }, ...]

validateThaiAddress({ postal_code: "10110", province: "ภูเก็ต" })
// { valid: false, reason: "province_mismatch", message: 'Postal code 10110 belongs to กรุงเทพมหานคร, not "ภูเก็ต"' }
```

District and sub-district are deliberately **not** enforced, because customers write them in too many ways. Use `lookupPostalCode` to suggest them instead.

## Tracking numbers

When creating a fulfillment, pass `tracking_number` in `additional_data` (Admin API: `POST /admin/orders/:id/fulfillments`). The label's tracking URL is built from the carrier's `trackingUrlTemplate`.

## Data

`src/data/thai-addresses.json` is generated from [thailand-geography-data/thailand-geography-json](https://github.com/thailand-geography-data/thailand-geography-json) (MIT, © Joe Takara). To rebuild it from a newer copy:

```bash
node scripts/build-addresses.mjs path/to/geography.json
```

Postal codes change from time to time, so refresh the data before each release.

## Develop

```bash
npm install
npm test            # 33 unit tests
npm run typecheck
npm run build
```

## Status

- [x] Unit-tested rate logic, address validation and provider methods
- [x] Verified in a running Medusa 2.21.2 instance: options created in Admin, prices via `/calculate`, checkout blocked on bad addresses, tracking label stored on the fulfillment
- [ ] Example storefront (planned: `thai-commerce-storefront`)

## License

MIT. Address data: MIT, see [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
