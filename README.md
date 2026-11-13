# OPC

**Operations for multi-location retail**

מערכת הפעלה תפעולית לרשתות מרובות סניפים — לא עוד מערכת Ticketing.  
הפיילוט הראשון רץ בישראל, תחת המותג הציבורי OPC.

בידול ופילטר החלטות: [`docs/DIFFERENTIATION.md`](docs/DIFFERENTIATION.md).

## עקרונות פיילוט

- ערוץ דיווח: **WhatsApp** (מנהלי חנויות מזוהים לפי טלפון)
- QR: **חירום / גיבוי** בלבד
- מספר WhatsApp **לכל מדינה** (לא לכל חנות)
- שפה: **עברית**
- שיוך: מאגר אנשי מקצוע (+ מידרג כ־bootstrap)
- מיתוג ציבורי: OPC

## Stack

Next.js 15 · TypeScript · Tailwind · Supabase · Vercel

## הרצה מקומית

```bash
cp .env.example .env.local
npm install
npm run dev
```

בלי מיגרציות על Supabase האפליקציה נופלת אוטומטית ל־**memory backend** לדמו.

## סקריפט דמו (E2E)

1. `/ops/simulator` — שלחו `STORE_172` ואז `המזגן הראשי לא עובד` (דמו / FORCE_MEMORY)
2. `/ops/tickets` — פתחו את התקלה, סמנו דחוף, אשרו איש מקצוע
3. או לחצו **תקלת הדגמה לטכנאי** (יוצר + משייך)
4. `/tech` — התחילו טיפול → סיום עם הערה (נתיב משני)

API מהיר:

```bash
curl -X POST localhost:3000/api/demo/whatsapp \
  -H 'content-type: application/json' \
  -d '{"wa_id":"972501111111","text":"STORE_172"}'

curl -X POST localhost:3000/api/demo/whatsapp \
  -H 'content-type: application/json' \
  -d '{"wa_id":"972501111111","text":"המזגן הראשי לא עובד"}'

curl 'localhost:3000/api/demo/seed-ticket?assign=1'
```

## Supabase

מיגרציות ב־`supabase/migrations/`.

```bash
SUPABASE_DB_PASSWORD=... node scripts/apply-migrations.mjs
npm run db:sync-managers
```

אופציונלי לכפות זיכרון גם כשיש DB:

```bash
MAINTAINOS_FORCE_MEMORY=1
```

## מסמכים

- [`docs/DIFFERENTIATION.md`](docs/DIFFERENTIATION.md) — בידול ופילטר פיצ׳רים
- [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) — מערכת עיצוב
- [`docs/PRODUCT_DECISIONS.md`](docs/PRODUCT_DECISIONS.md) — החלטות מוצר
- [`docs/ROLES_AND_ACCESS.md`](docs/ROLES_AND_ACCESS.md) — תפקידים
- [`docs/PILOT_SCENARIOS.md`](docs/PILOT_SCENARIOS.md) — תרחישי פיילוט
- [`docs/NETWORK_LAUNCH_CHECKLIST.md`](docs/NETWORK_LAUNCH_CHECKLIST.md) — השקת רשת
- [`docs/CORE_FEATURES_ROADMAP.md`](docs/CORE_FEATURES_ROADMAP.md) — ליבה + post-core
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
- [`docs/SECURITY.md`](docs/SECURITY.md)
- [`docs/MESSAGING_COST_POLICY.md`](docs/MESSAGING_COST_POLICY.md)
- [`docs/META_WHATSAPP_TEMPLATE_FOLLOWUP.md`](docs/META_WHATSAPP_TEMPLATE_FOLLOWUP.md)
- [`docs/VERCEL_AI_WHATSAPP.md`](docs/VERCEL_AI_WHATSAPP.md)
- [`docs/WHATSAPP_PHONE_CONNECT_PLAN.md`](docs/WHATSAPP_PHONE_CONNECT_PLAN.md)
