# תרחישי פיילוט — Supabase production

הריצו **אחרי** `npm run db:migrate` על Supabase אמיתי (לא `MAINTAINOS_FORCE_MEMORY`).

מדד מוכנות חי: [`/api/health/pilot`](https://optical-center-rose.vercel.app/api/health/pilot) · Runbook: [`docs/META_PILOT_HANDOFF.md`](./META_PILOT_HANDOFF.md)

## מחזור ראשי (ככה זה עובד בפועל)

| # | תרחיש | צעדים | KPI |
|---|--------|--------|-----|
| 1 | דיווח מנהל חנות ב-WA | מנהל כותב לבוט (טלפון מזוהה אוטומטית) → תיאור + תמונה | תקלה ב-HQ < 60s בלי לשאול STORE_ |
| 2 | שיוך איש מקצוע | HQ דחוף → מאגר / מידרג → אשר | סטטוס `engaged` + שמירה במאגר |
| 3 | הודעות אחרי lock | WA למנהל (פרטי איש מקצוע + תקלות) · SMS לאיש מקצוע (טלפון מנהל + סיכום + קישור `/pro`) | WA < 30s · SMS עם לינק אישי |
| 4 | אזור אישי לאיש מקצוע | פתיחת קישור מה-SMS → רשימת עבודות + חייג למנהל | רק תקלות שארי שייך |
| 5 | אישור חנות | מנהל מאשר ב-WA / `/store` | `closed` (נתיב engaged) |
| 6 | דוחות | `/ops/reports` → Excel/PDF | export 200 OK |

### גיבוי / חירום (לא נתיב ראשי)

| # | תרחיש | מתי |
|---|--------|-----|
| E1 | QR → WA | חירום / טלפון לא ממופה |
| E2 | `/report?store=` | גיבוי web |
| E3 | שיוך טכנאי פנימי `/tech` | משני — כשיש טכנאי רשת |

## הכנה לפני טסט שדה

```bash
# סנכרון מנהלי חנויות → stores + store_phones
node scripts/sync-store-managers.mjs

# מיגרציית professional_id על engagements
npm run db:migrate
```

- `SMS_019_ENABLED=1` + credentials 019 (ל-SMS לאיש מקצוע)
- החלפת מנהל: `/ops/stores/[code]` → «החלף מנהל»

## אימות אוטומטי (memory / CI)

Playwright: `e2e/pilot-scenarios.spec.ts` — Midrag lock UI + report.  
Unit: `npm test -- src/modules/pro src/modules/stores/manager-identity src/modules/engagements`

## Checklist production

### צד בנייה
- [x] מיגרציית AI Intake על Supabase
- [ ] מיגרציית `engagement_professional_id`
- [ ] `node scripts/sync-store-managers.mjs` רץ על פרוד
- [x] `MAINTAINOS_FORCE_MEMORY` **לא** set
- [x] bucket `ticket-media`
- [ ] `SMS_019_ENABLED=1` לפיילוט שדה עם אנשי מקצוע

### צד Meta
- [x] Webhook + credentials
- [x] מספר עסקי מוגדר
- [ ] QR מודפס **לחירום בלבד** (2–3 סניפים)
