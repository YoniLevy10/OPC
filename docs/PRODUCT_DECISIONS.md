# החלטות מוצר — פיילוט Optical Center IL

תיעוד החלטות הנהלה (Phase E + ישיבת מנהלים).  
מצפן בידול: [`DIFFERENTIATION.md`](DIFFERENTIATION.md).  
תמונת מצב חיה: [`OPC_3_EXECUTIVE_STATUS.md`](OPC_3_EXECUTIVE_STATUS.md).

| נושא | החלטה | יישום |
|------|--------|--------|
| בידול / היקף | MILO = OS תפעולי לרשתות; לא ticketing גנרי ולא custom-per-client. ליבה אחידה; משתנה רק מיתוג, הרשאות, סוגי תקלות, SLA | `docs/DIFFERENTIATION.md` |
| דוחות | CSV + Excel + PDF + dashboard מספיק; PDF לא חובה נפרד | `/api/reports/export?format=csv\|xlsx\|pdf` |
| היסטוריה | דוחות חודשיים נשמרים ידנית | `/ops/reports/history` + `report_snapshots` |
| התראות טכנאי פנימי | WhatsApp עם קישור `/tech` (משני); Web Push כש־VAPID מוגדר | `modules/notifications` + `modules/push/send.ts` |
| שיוך איש מקצוע | מאגר `/ops/professionals` קודם; מידרג כ־bootstrap; lock → WA למנהל + SMS לאיש מקצוע עם קישור `/pro` | `engagements/service.ts` + `modules/pro/*` · דורש `SMS_019_ENABLED=1` |
| מנהלי חנויות | זיהוי WA לפי טלפון (DB); החלפה ב־`/ops/stores/[code]`; QR לחירום בלבד | `manager-identity.ts` + `replace-manager.ts` + `scripts/sync-store-managers.mjs` |
| Inbox reply | HQ יכול לשלוח WA (UI קיים); policy: takeover + ticket ops | ללא שינוי policy ב-wave זה |
| Auth | Google (Gmail מאושר) או מייל+סיסמה שסופקו ע״י מנהל; ללא כניסה פתוחה | `/login` + allowlist + Users admin |
| תפקידים | 4 בלבד: מנהל מערכת, תפעול, חנות, טכנאי | `docs/ROLES_AND_ACCESS.md` |
| מנהלי / עובדי חנות | **WhatsApp-primary** ממנהל מזוהה; `/store` גיבוי; QR חירום | intake לפי `manager_phone` / `store_phones`; confirm ב־WA אחרי `engaged`/`resolved` |
| מדיה | תמונה + וידאו (עד 3), Bamakor-style; הקלטות WA נשמרות כ־`kind: audio` עם נגן ב־Evidence; כישלון תמלול → תקלת placeholder + אודיו + משימת ארי | web + WA + tech upload; `AI_GATEWAY_API_KEY` / `OPENAI_API_KEY` לתמלול |
| הוכחת סיום | סגירה ל־`resolved` דורשת תמונה או וידאו; ארי (`global_maintenance`) יכול חריגה עם סיבה → `resolve_override` ב־ticket_events | `updateStatus` proof gate |
| ביקור משולב | `service_visits` + `service_visit_tickets`; שיגור per-ticket עם `vendor_dispatches.visit_id` | `/api/ops/visits` + multi-select בתור/סניף |
| Phase D | PDF מתוזמן + email — **הושלם** (`/api/cron/monthly-report`); i18n FR, OAuth domain, Push — **אחרי** go-live IL | «בקרוב» ל־Push / i18n |

## שלב D — אחרי go-live IL

- i18n צרפת
- ~~Web Push production + VAPID~~ (זמין כש־`VAPID_*` מוגדרים)
- ~~cron דוח חודשי + email~~ (הושלם בגל 2)
- Google domain restriction (MFA)
