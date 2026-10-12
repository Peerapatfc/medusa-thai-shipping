import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import ThaiShippingProviderService from "./service"

export default ModuleProvider(Modules.FULFILLMENT, {
  services: [ThaiShippingProviderService],
})
