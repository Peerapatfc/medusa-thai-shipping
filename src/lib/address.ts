import data from "../data/thai-addresses.json"

type Dataset = {
  provinces: Record<string, { th: string; en: string }>
  entries: Array<[string, number, string, string]> // [postalCode, provinceCode, district(th), subdistrict(th)]
}

const dataset = data as unknown as Dataset

export type AddressMatch = {
  postal_code: string
  province_code: number
  province_th: string
  province_en: string
  district_th: string
  subdistrict_th: string
}

const byPostal = new Map<string, AddressMatch[]>()
for (const [postal, provinceCode, district, subdistrict] of dataset.entries) {
  const p = dataset.provinces[String(provinceCode)]
  const list = byPostal.get(postal) ?? []
  list.push({
    postal_code: postal,
    province_code: provinceCode,
    province_th: p.th,
    province_en: p.en,
    district_th: district,
    subdistrict_th: subdistrict,
  })
  byPostal.set(postal, list)
}

const BANGKOK_ALIASES = ["กรุงเทพ", "กรุงเทพฯ", "กทม", "bangkok", "bkk", "krungthep"]

/** Lower-cases and strips "จังหวัด"/"จ." prefixes, spaces and punctuation so that user input compares reliably. */
export function normalizeProvince(input: string): string {
  return input
    .toLowerCase()
    .replace(/^\s*(จังหวัด|จ\.)\s*/u, "")
    .replace(/\s*(province|metropolis|city)\s*$/u, "")
    .replace(/[\s.\-ฯ]/gu, "")
}

function provinceMatches(input: string, match: AddressMatch): boolean {
  const n = normalizeProvince(input)
  if (!n) return false
  if (match.province_code === 10 && BANGKOK_ALIASES.some((a) => normalizeProvince(a) === n)) return true
  return normalizeProvince(match.province_th) === n || normalizeProvince(match.province_en) === n
}

/** Digits only, 5 long. Thai postcodes keep leading digits, so keep them as strings. */
export function normalizePostalCode(input: string | number | undefined | null): string | null {
  if (input === undefined || input === null) return null
  const s = String(input).trim()
  return /^\d{5}$/.test(s) ? s : null
}

/** All sub-districts that share a postal code. Handy for storefront autocomplete. */
export function lookupPostalCode(postalCode: string | number): AddressMatch[] {
  const code = normalizePostalCode(postalCode)
  return code ? (byPostal.get(code) ?? []) : []
}

export type AddressCheck =
  | { valid: true; province_code: number; matches: AddressMatch[] }
  | { valid: false; reason: "invalid_postal_code" | "unknown_postal_code" | "province_mismatch"; message: string }

/**
 * Checks that the postal code exists and, when a province is supplied, that it agrees with the code.
 * District and sub-district are intentionally not enforced: customers spell them in too many ways.
 */
export function validateThaiAddress(input: { postal_code?: string | number | null; province?: string | null }): AddressCheck {
  const code = normalizePostalCode(input.postal_code)
  if (!code) {
    return { valid: false, reason: "invalid_postal_code", message: "Postal code must be 5 digits" }
  }
  const matches = byPostal.get(code)
  if (!matches) {
    return { valid: false, reason: "unknown_postal_code", message: `Postal code ${code} does not exist in Thailand` }
  }
  const province = input.province?.trim()
  if (province) {
    const hit = matches.find((m) => provinceMatches(province, m))
    if (!hit) {
      const expected = [...new Set(matches.map((m) => m.province_th))].join(", ")
      return {
        valid: false,
        reason: "province_mismatch",
        message: `Postal code ${code} belongs to ${expected}, not "${province}"`,
      }
    }
    return { valid: true, province_code: hit.province_code, matches }
  }
  return { valid: true, province_code: matches[0].province_code, matches }
}
