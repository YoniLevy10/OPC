# QA tooling notes

## Commands

| Script | Purpose |
|--------|---------|
| `npm test` | Vitest unit/API/domain |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test:e2e` | Build + Playwright chromium |
| `npm run test:e2e:all` | All Playwright projects |
| `npm run test:qa` | lint + typecheck + unit + e2e + build |
| `npm run test:qa:load` | Synthetic 800×10k bottleneck JSON |

## Env

- Default E2E/webServer: `MAINTAINOS_FORCE_MEMORY=1`
- Supabase parity: unset force memory and provide live service role

## Historical artifacts

Stabilize-era reports and checklists live under  
[`docs/archive/2026-stabilize/qa/`](../archive/2026-stabilize/qa/) — not current backlog.
