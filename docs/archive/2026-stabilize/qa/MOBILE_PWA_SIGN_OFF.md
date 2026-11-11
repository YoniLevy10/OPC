# Mobile / PWA sign-off

**Date:** 2026-11-11  
**Scope:** PhoneKit rebuild (HQ + Tech + Store), no Capacitor.

## Shipped in code

| Area | Change |
|------|--------|
| PhoneKit | `src/components/mobile/*` — Shell, TabBar, ActionDock, Sheet, List/Row, Stack |
| HQ nav | Tabs: סקירה · תקלות · חנויות · עוד; manifest shortcuts aligned |
| Ticket detail | Sticky `PhoneActionDock` for engagement CTAs |
| Ticket queue | `PhoneSwipeRow` actions |
| Tech | PhoneList + PhoneSheet + ActionDock via TechShell |
| Store | PhoneShell + PhoneTabBar |
| Inbox | PhoneStack list→detail on phone |
| Gates | `PhoneDesktopOnly` is passthrough — lab/simulator/status usable on phone |
| SW | `maintainos-static-v10` + SKIP_WAITING + `SwUpdateBanner` |
| e2e | Bottom nav asserts updated; `mobile bottom nav + More` **PASS** (chromium) |

## Remaining (device)

- [ ] Full `docs/mobile-qa-checklist.md` on physical iPhone standalone (HQ + Tech)
- [ ] Confirm camera proof upload on a real device under poor network

## Not in scope

- Capacitor / App Store
- Document/API caching in SW
- Web Push for HQ
