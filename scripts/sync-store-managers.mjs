#!/usr/bin/env node
/**
 * Sync Israel store managers from the seed directory → stores + store_phones.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/sync-store-managers.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

function normalizePhoneDigits(input) {
  let digits = String(input).replace(/\D/g, '')
  if (!digits) return null
  if (digits.startsWith('0') && digits.length >= 9) {
    digits = `972${digits.slice(1)}`
  }
  if (digits.length < 8 || digits.length > 15) return null
  return digits
}

/** Parse ISRAEL_STORES entries from the TS seed (code + manager fields). */
function loadSeedManagers() {
  const here = dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(
    join(here, '../src/modules/stores/israel-stores.ts'),
    'utf8',
  )
  const rows = []
  const re =
    /\{\s*code:\s*'([^']+)'[\s\S]*?managerName:\s*'([^']*)'[\s\S]*?managerNameEn:\s*'([^']*)'[\s\S]*?managerPhone:\s*'([^']+)'/g
  let m
  while ((m = re.exec(src))) {
    rows.push({
      code: m[1],
      managerName: m[2],
      managerNameEn: m[3],
      managerPhone: m[4],
    })
  }
  return rows
}

const supabase = createClient(url, key, { auth: { persistSession: false } })
const seeds = loadSeedManagers()
if (!seeds.length) {
  console.error('No managers parsed from israel-stores.ts')
  process.exit(1)
}

let ok = 0
let fail = 0
for (const seed of seeds) {
  const waId = normalizePhoneDigits(seed.managerPhone)
  if (!waId) {
    console.error(`Bad phone ${seed.code} ${seed.managerPhone}`)
    fail++
    continue
  }
  const { data: store, error: sErr } = await supabase
    .from('stores')
    .select('id, code')
    .eq('code', seed.code)
    .maybeSingle()
  if (sErr || !store) {
    console.error(`Store ${seed.code}:`, sErr?.message || 'not found')
    fail++
    continue
  }

  const { error: uErr } = await supabase
    .from('stores')
    .update({
      manager_name: seed.managerName,
      manager_name_en: seed.managerNameEn,
      manager_phone: seed.managerPhone,
    })
    .eq('id', store.id)
  if (uErr) {
    console.error(`Update ${seed.code}:`, uErr.message)
    fail++
    continue
  }

  await supabase
    .from('store_phones')
    .update({ is_primary: false })
    .eq('store_id', store.id)
    .eq('is_primary', true)

  const { data: existing } = await supabase
    .from('store_phones')
    .select('id')
    .eq('wa_id', waId)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('store_phones')
      .update({
        store_id: store.id,
        is_primary: true,
        label: 'מנהל חנות',
      })
      .eq('id', existing.id)
    if (error) {
      console.error(`Phone ${waId}:`, error.message)
      fail++
      continue
    }
  } else {
    const { error } = await supabase.from('store_phones').insert({
      store_id: store.id,
      wa_id: waId,
      is_primary: true,
      label: 'מנהל חנות',
    })
    if (error) {
      console.error(`Insert ${waId}:`, error.message)
      fail++
      continue
    }
  }

  console.log(`OK ${seed.code} ${seed.managerName} ${seed.managerPhone}`)
  ok++
}

console.log(`Done. synced=${ok} failed=${fail}`)
process.exit(fail ? 1 : 0)
