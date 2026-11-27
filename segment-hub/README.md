# OIG Segment Integration Hub

מחליף את EasySale כגשר בין SAP Business One לסגמנט/אלקטרה. ‎.NET 9 · C# · Clean Architecture.
שרת יעד: **SERVER2025**. ברירת המחדל: **מצב צל** — שום כתיבה ל‑SAP עד החלטה מפורשת.

ראה `docs/ARCHITECTURE.md` לעיצוב המלא. זהו שלד + ממשק ייחוס אחד (SupplyApprovals), מבנה שמתאים לכל 12 הממשקים.

## דרישות
- .NET SDK 9
- גישה ל‑SAP B1 Service Layer (https://SERVER2025:50000/b1s/v1)
- SQL Server (SAP_OIG) להרצת `docs/HubProcessingLog.sql`

## בנייה ובדיקות
```bash
dotnet restore
dotnet build -c Release
dotnet test
```
הבדיקות מכסות את תיקון שורש התקלה (נרמול מספר תעודת משלוח: נקודה בסוף, רווחים, אפסים מובילים).

## הגדרה
- `src/SegmentHub.Worker/appsettings.json` — נתיבים, קידוד per‑interface, מפת branch→fatherCard, `ShadowMode`.
- סודות (סיסמת Service Layer, webhook של Teams) ב‑user‑secrets או משתני סביבה, **לא** ב‑appsettings:
```bash
dotnet user-secrets set "Hub:ServiceLayer:Password" "***"
dotnet user-secrets set "Alerting:TeamsWebhookUrl" "<workflows-url>"
```

## הרצה
```bash
dotnet run --project src/SegmentHub.Worker
```
במצב צל: המערכת קוראת קבצים מתיקיית `_HubInbox` תחת כל ממשק, מריצה את הצינור המלא, רושמת ל‑SQL ול‑Serilog מה **היתה** עושה, ולא כותבת ל‑SAP.

## מעבר לפרודקשן (ממשק‑ממשק, לא big‑bang)
1. מריצים שבועיים במצב צל, משווים ל‑EasySale (לוג `SHADOW[...]` + טבלת `HubProcessingLog`).
2. כשממשק מראה פאריטי מלא — מעבירים **רק אותו** לחי: `Hub:Interfaces:SupplyApprovals:ShadowMode=false`.
3. EasySale נשארת כגיבוי עד שכל הממשקים הועברו.

## מבנה
```
src/
  SegmentHub.Domain                 מודל טהור (DocumentKey = תיקון השורש)
  SegmentHub.Application            הפשטות + צינור
  SegmentHub.Infrastructure        Service Layer, קבצים, SQL, Teams
  SegmentHub.Modules.SupplyApprovals  ממשק הייחוס
  SegmentHub.Worker                host + polling
tests/SegmentHub.Tests
docs/ARCHITECTURE.md, HubProcessingLog.sql
```

## אזהרת פרודקשן
לפני מעבר לחי יש לאמת שמות שדות ב‑Service Layer מול המטא‑דאטה, להשלים מפת branch→fatherCard מ‑`@ESG_CONF`,
ולהקים תהליך שמזין את `_HubInbox`. ראה "מה עדיין פתוח" ב‑ARCHITECTURE.
