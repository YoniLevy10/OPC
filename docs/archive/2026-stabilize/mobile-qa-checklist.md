# Mobile / PWA flow QA checklist

Device: iPhone Safari → Add to Home Screen (standalone).

**Status:** PhoneKit rebuild — run on a real device after deploy.

## HQ (OPC Ops) — Ari

- [ ] Install PWA from Safari (Share → Add to Home Screen); opens `/ops/dashboard`
- [ ] Bottom nav: **סקירה · תקלות · חנויות · עוד**
- [ ] More drawer: WhatsApp, אנשי מקצוע, מסמכים, דוחות, הגדרות
- [ ] Overview KPIs / exception queues tappable → tickets
- [ ] Tickets: operational list (not 7-col table); swipe reveals לטפל / שיבוץ
- [ ] Ticket detail: **PhoneActionDock** sticky above tab bar + home indicator (שיבוץ / דחוף / בטל)
- [ ] Sheets (filters / Midrag) sit above dock; dock hides while dialog open
- [ ] Stores: reachable from tab bar; usable on phone
- [ ] Inbox: list → conversation on phone (`PhoneStack`)
- [ ] Safe area: nav, dock, toasts clear the home indicator
- [ ] Deep link `/ops/tickets/[id]` opens inside installed app
- [ ] SW update banner appears on new deploy (not silent)
- [ ] Lab / simulator / status / print-QR open on phone (not blocked)

## Tech portal

- [ ] `/tech` uses tech manifest; installable separately
- [ ] Job list via PhoneList / PhoneRow
- [ ] Claim / start / finish in ≤4 taps; PhoneActionDock sticky
- [ ] Camera / gallery (`capture=environment`) + treatment note before resolve
- [ ] Safe-area header + dock

## Store portal

- [ ] `/store` bottom tabs: התקלות שלי · דיווח גיבוי
- [ ] Ticket list + report flow usable one-handed

## Desktop regression

- [ ] Sidebar + dense tables at `md+`
- [ ] Ticket engagement form inline (dock hidden on desktop)
- [ ] Inbox three-pane layout at `lg+`
