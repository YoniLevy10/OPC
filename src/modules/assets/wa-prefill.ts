/**
 * Pure WhatsApp prefill helpers — safe for client components.
 * Keep this free of server-only / Supabase imports.
 */

export function assetWhatsAppPrefill(storeCode: string, assetCode: string) {
  return `STORE_${storeCode} ASSET_${assetCode}`
}
