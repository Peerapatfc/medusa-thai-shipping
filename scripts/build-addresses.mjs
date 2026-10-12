// Builds src/data/thai-addresses.json from thailand-geography-data/thailand-geography-json (MIT).
// Usage: node scripts/build-addresses.mjs path/to/geography.json
import { readFileSync, writeFileSync } from "node:fs"

const src = process.argv[2]
if (!src) throw new Error("usage: node scripts/build-addresses.mjs <geography.json>")

const rows = JSON.parse(readFileSync(src, "utf8"))
const provinces = {}
const entries = []
for (const r of rows) {
  provinces[r.provinceCode] = { th: r.provinceNameTh, en: r.provinceNameEn }
  entries.push([String(r.postalCode), r.provinceCode, r.districtNameTh, r.subdistrictNameTh])
}
entries.sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1])

const out = new URL("../src/data/thai-addresses.json", import.meta.url)
writeFileSync(out, JSON.stringify({ provinces, entries }))
console.log(`provinces=${Object.keys(provinces).length} entries=${entries.length}`)
