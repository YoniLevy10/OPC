import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Children, isValidElement, type ReactNode, type ElementType } from 'react'

const state = vi.hoisted(() => ({ actor: null as unknown, demo: false, visible: vi.fn(), fallback: vi.fn(), tickets: vi.fn() }))
vi.mock('@/lib/auth/server-actor', () => ({ getServerActor: async () => state.actor }))
vi.mock('@/lib/auth/home-path', async (original) => ({ ...await original<typeof import('@/lib/auth/home-path')>(), shouldAllowDemoEntry: () => state.demo }))
vi.mock('next/navigation', () => ({ redirect: () => { throw new Error('login required') } }))
vi.mock('@/lib/auth/store-asset-scope', () => ({ visibleStores: state.visible }))
vi.mock('@/modules/stores/data', async (original) => ({ ...await original<typeof import('@/modules/stores/data')>(), fetchStores: state.fallback }))
vi.mock('@/modules/tickets/service', () => ({ listTickets: state.tickets }))
vi.mock('@/modules/stores/business-phone', () => ({ resolveWhatsAppBusinessPhone: async () => '972501234567' }))
vi.mock('./report/store-report-form', () => ({ StoreReportForm: () => null }))
vi.mock('../ops/users/users-admin', () => ({ UsersAdmin: () => null }))
vi.mock('@/components/layout/store-shell', () => ({ StoreShell: () => null }))

import StoreHomePage from './page'
import StoreReportPage from './report/page'
import UsersPage from '../ops/users/page'
import PrintQrBatchPage from '../ops/stores/print-qr/page'
import StoreLayout from './layout'
import { StoreShell } from '@/components/layout/store-shell'
import { StoreReportForm } from './report/store-report-form'
import { UsersAdmin } from '../ops/users/users-admin'

const own = { id: 'own-store', code: '6006', name: 'Assigned branch', is_active: true }
const poison = { id: 'foreign-store', code: '99109', name: 'Private unrelated branch', is_active: true }
function findElement(node: ReactNode, type: ElementType): Record<string, unknown> | null {
  if (!isValidElement(node)) return null
  if (node.type === type) return node.props as Record<string, unknown>
  for (const child of Children.toArray((node.props as { children?: ReactNode }).children)) {
    const found = findElement(child, type)
    if (found) return found
  }
  return null
}

describe('SSR store assignment and catalog boundaries', () => {
  beforeEach(() => {
    state.actor = { memberships: [{ role: 'store_employee', store_id: own.id }] }
    state.demo = false
    state.visible.mockReset().mockResolvedValue({ stores: [own], backend: 'memory' })
    state.fallback.mockReset().mockResolvedValue({ stores: [poison], fromDb: false })
    state.tickets.mockReset().mockResolvedValue({ tickets: [] })
  })

  it('does not assign the first global branch to an authenticated shop with no assignment', async () => {
    state.actor = { memberships: [{ role: 'store_employee', store_id: null }] }
    const home = await StoreHomePage()
    const report = await StoreReportPage()
    expect(JSON.stringify(home)).not.toContain(poison.name)
    expect(findElement(report, StoreReportForm)).toBeNull()
    expect(state.fallback).not.toHaveBeenCalled()
    expect(state.tickets).not.toHaveBeenCalled()
  })

  it('does not report against a store ID that is absent from the authorized directory', async () => {
    state.actor = { memberships: [{ role: 'store_employee', store_id: poison.id }] }
    expect(findElement(await StoreReportPage(), StoreReportForm)).toBeNull()
    await StoreHomePage()
    expect(state.tickets).not.toHaveBeenCalled()
    expect(state.fallback).not.toHaveBeenCalled()
  })

  it('keeps legitimate assigned-store reporting available', async () => {
    expect(findElement(await StoreReportPage(), StoreReportForm)).toMatchObject({ storeCode: own.code, storeName: own.name, locked: true })
    expect(state.visible).toHaveBeenCalledWith(state.actor, false)
    expect(state.fallback).not.toHaveBeenCalled()
  })

  it('does not leak another tenant branch name in the portal header for an invalid assignment', async () => {
    state.actor = { memberships: [{ role: 'store_employee', store_id: poison.id }] }
    const props = findElement(await StoreLayout({ children: 'Portal content' }), StoreShell)
    expect(props?.storeName).toBeUndefined()
    expect(props?.storeCode).toBeUndefined()
    expect(state.fallback).not.toHaveBeenCalled()
  })

  it('retains the fallback only for explicitly enabled unauthenticated demo mode', async () => {
    state.actor = null
    state.demo = true
    state.fallback.mockResolvedValue({ stores: [own], fromDb: false })
    expect(findElement(await StoreReportPage(), StoreReportForm)?.storeCode).toBe(own.code)
    expect(state.visible).not.toHaveBeenCalled()
    expect(state.fallback).toHaveBeenCalledTimes(1)
  })

  it('requires authentication when demo access is disabled', async () => {
    state.actor = null
    await expect(StoreHomePage()).rejects.toThrow('login required')
    await expect(StoreReportPage()).rejects.toThrow('login required')
    expect(state.fallback).not.toHaveBeenCalled()
  })

  it('does not hydrate user administration with foreign branch names', async () => {
    const props = findElement(await UsersPage(), UsersAdmin)
    expect(props?.stores).toEqual([{ id: own.id, code: own.code, name: own.name }])
    expect(state.visible).toHaveBeenCalledWith(state.actor, true)
    expect(state.fallback).not.toHaveBeenCalled()
  })

  it('prints only branches returned by the authenticated directory scope', async () => {
    const html = JSON.stringify(await PrintQrBatchPage())
    expect(html).toContain(own.name)
    expect(html).not.toContain(poison.name)
    expect(state.visible).toHaveBeenCalledWith(state.actor, false)
    expect(state.fallback).not.toHaveBeenCalled()
  })
})
