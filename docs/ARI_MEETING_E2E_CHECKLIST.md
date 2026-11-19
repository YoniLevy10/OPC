# Ari meeting — E2E verification checklist

Manual verification for items marked **טופל / דורש אימות** and bot/assistant behaviour.

## G — העברה לאיש מקצוע (WhatsApp forward)

1. Open an open ticket in `/ops/inbox` or ticket detail with media attached.
2. Run **שתף תקלה עם מקצוען** / forward-pro on a professional with a phone.
3. Confirm the pro receives (or dry-run logs) a summary + media on the `pro_coord` thread.
4. Confirm Ari can still cancel / choose another pro — no engagement lock unless explicitly locked.
5. Pilot env: set `MAINTAINOS_WA_OUTBOUND_MEDIA_LIVE=1` when live media outbound is required.

## H — בוט אחרי עריכת תיאור

1. Open a ticket via WhatsApp with photo + description.
2. From HQ: `PATCH /api/tickets/{id}` with `{ "description": "…" }` — timeline shows **עודכן תיאור התקלה** with previous/new text in history.
3. From store WA (session `done`): send `עדכון …` — message attaches to the same ticket; description SoT updates; **no** second ticket.
4. Confirm closed tickets: follow-up does not reopen booking / Midrag / engagement.
5. Confirm Ari assistant (`replyToAri`) reads the updated description via `getById`.

## I — עוזר אישי של ארי (WhatsApp)

1. Ask for open tickets by store — list matches `/ops`.
2. Ask about a **closed** ticket — no false “open” status.
3. Multiple open tickets — replies disambiguate or list, no mix-up.
4. Spend / money request — lands as pending; requires Ari `לאשר` before execute.
5. `draft_engagement` / book pro — requires explicit Ari confirmation path; no silent financial commitment.

## J — צרפתית (UI + WhatsApp)

1. In `/ops`, set language to **FR** (sidebar switcher). Confirm dashboard, tickets, approvals, alerts, inbox chrome has **no Hebrew** labels/buttons/empty states.
2. From Ari’s WhatsApp, write in French (e.g. `Quelles pannes sont ouvertes ?` / `ouvrir accueil`) — reply is French; links still open `/ops`.
3. French desk decisions: `approuver` / `refuser` / `demander infos` behave like `לאשר` / `לדחות` / `לבקש מידע`.
4. Switch back to Hebrew in the UI; WA Hebrew messages still get Hebrew replies (per-message detection).

## Payment SMS (wave 1)

1. Lock a professional, complete work, store confirms close.
2. Professional receives SMS: bank transfer within 10 days + receipt to `harry.bendriem@optical-center.com`.
3. `/pro` and `/pro/[id]` show the same payment terms.

## Push / badge

1. Enable Web Push in Ops settings.
2. Open a new ticket (WA or web with photo) — push arrives with deep link `/ops/tickets/{id}`.
3. Open `/ops/alerts` — unread counter clears; home-screen badge clears on supported devices.
