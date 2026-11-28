# Segment Integration Hub — ארכיטקטורה

מערכת שמחליפה את EasySale כגשר בין SAP Business One (OIG) לסגמנט/אלקטרה.
‎.NET 9 · C# · Clean Architecture · SOLID. נבנתה על בסיס האפיון וההתנהגות שנצפתה ב‑EasySale בפועל.

## עקרון מנחה
EasySale נכשלת בשקט: קובץ שלא מתקשר נזרק ל‑Failed בלי סיבה (`no _MSG`), ומחזור יומי אחד מסתיר תקלות ליום שלם.
המערכת הזו הופכת כל כשל לאירוע **מפורש, מתועד ונראה**, ומריצה כל ממשק ב**מצב צל** עד שהוא מוכיח פאריטי.

## שכבות (Clean Architecture)
```
Domain          מודל טהור, בלי תלות חיצונית  (DocumentKey, SupplyApproval, ProcessingResult)
  ^
Application     הפשטות וצינור גנרי           (ISegmentModule, ISapGateway, IRecordParser/Validator/Mapper)
  ^
Infrastructure  מימושים                      (Service Layer, FileSystemQueue, SQL audit, Teams)
  ^
Worker          הרכבה + אירוח                (Generic Host, Serilog, InboundPollingService)

Modules.*       ממשק אחד לכל מודול            (Modules.SupplyApprovals = ממשק הייחוס)
```
התלות תמיד פנימה. Domain לא יודע על SAP, על קבצים או על SQL.

## הצינור הגנרי (זהה לכל ממשק)
```
decode → parse → validate(SAP) → map → post(SAP)
                      │                    │
                      └── rejection        └── בשדו: לא נכתב כלום
```
- **decode** — Windows‑1255 לכל הממשקים הנכנסים (Orders ו‑SupplyApprovals), בדיוק כמו ה‑CsvReader של EasySale.
- **parse** — מבנה הקובץ חי רק במודול. **מיפוי העמודות אומת מול הקוד המפורק של EasySale** (`ESG_SegmentFiles_API`), לא מנוחש. קלט שגוי מחזיר rejection, לא exception.
- **validate** — מול מצב SAP אמיתי. כאן נחסם הכשל הכרוני ("אין ת. משלוח מקושרת") עם קוד וסיבה.
- **map** — בניית טיוטת מסמך SAP.
- **post** — רק במצב חי. במצב צל מדולג, והתוצאה נרשמת להשוואה.

## תיקון שורש התקלה: DocumentKey
`DocumentKey.From(raw)` מנרמל מספר תעודה פעם אחת, מרכזית: מוריד נקודה בסוף, רווחים, CR/LF, BOM ואפסים מובילים.
`2003837.` ו‑`2003837` הופכים לאותו מפתח. זה בדיוק מה ש‑EasySale פספסה ב‑13.11. מכוסה בבדיקות.

## מצב צל וחיתוך לפרודקשן
- `Hub:ShadowMode=true` גלובלי → שום כתיבה ל‑SAP בשום ממשק.
- לכל ממשק `ShadowMode` משלו שדורס את הגלובלי → מעבירים **ממשק‑ממשק** לחי, לא big‑bang.
- קריטריון חיתוך: שבועיים של פאריטי מלא מול EasySale על נתוני פרודקשן, בלוג ההשוואה.
- המערכת קוראת מתיקיית **העתק** (`_HubInbox`), לא מהתיקיות החיות של EasySale — כדי שלא יהיו שני צרכנים על אותו קובץ. זה הכשל שגרם לתקלה המקורית.

## NFR (איכות)
| תכונה | איך |
|---|---|
| אמינות | כל כשל מתועד; faults retryable; audit לא מפיל את הצינור |
| נראוּת (Observability) | Serilog מובנה, scope per‑file, טבלת `HubProcessingLog` ב‑SQL, התראות Teams |
| אבטחה | סיסמאות ב‑user‑secrets/env, לא ב‑appsettings; SQL פרמטרי; קריאה עם FileShare |
| תחזוקה | ממשק = מודול. הוספה בלי לגעת במנוע |
| הרחבה | 12 ממשקים כמודולים נפרדים תחת אותו host |
| עמידות | אין נעילת קבצים; מחזור polling מבודד per‑module עם back‑off |

## ממשקים (מפת דרכים)
**נכנסים (import):**
- **SupplyApprovals** (ממשק 11, אישור אספקה → חשבונית) — מיפוי אומת מול EasySale; מוכח end‑to‑end במצב צל מול SAP.
- **Orders** (ממשק 1, הזמנה → הזמנת מכר) — מיפוי אומת מול EasySale ומול שורת פרודקשן אמיתית.

**יוצאים (export):**
- **HundredFile** (ממשק 7, קובץ 100) — outbound, מוקשח (סכומים שליליים/חריגה נחסמים).
- **DeliveryNotes** (ממשק 9) — EasySale **מייצא** תעודות משלוח (SAP→קובץ), לא מייבא סטטוס. המודול הנכנס שנבנה היה בכיוון הפוך ו**הושבת** (`Enabled:false`) עד שתואם הדרישה האמיתית. צריך להיבנות מחדש כמודול ייצוא.

ממתינים: POD/Cheetah (ממשק 12, חסום בטוקן), StockLevels, Returns.

## מה עדיין פתוח (לפני חי)
1. שם ה‑company DB של הפרודקשן ל‑shadow אמיתי (נבדק מול TEST_OIG בלבד עד כה).
2. אימות שמות שדות ב‑Service Layer מול המטא‑דאטה החי (SegmentHub מדבר SL; EasySale השתמשה ב‑DI API/SQL, אז שמות השדות הם תכנון שלנו).
3. התקנת תהליך שמעתיק קבצים נכנסים ל‑`_HubInbox`.
4. מיגרציית טבלת `HubProcessingLog` + משתמש SAP ייעודי (SEGHUB) במקום לוגין אישי.
5. בנייה מחדש של DeliveryNotes כמודול ייצוא, אם ממשק 9 בתחום.

## Home-delivery invoicing (בית לקוח, Cheetah) — `SegmentHub.Modules.HomeDelivery`

Outbound module `HomeDeliveryInvoicing`, runs daily at 19:00 (after Chita-POD-to-SAP at 18:00).
Reuses existing signals; no direct Cheetah API:

| signal | source |
|---|---|
| delivered + receipt date | `chita-receipt-dates.json` (Cheetah Daily job), keyed by source sales-order DocNum |
| signed POD | SAP attachment on the DN whose file name contains "חתימה" |
| not yet invoiced | DLN1 open lines > 0 |
| no double-billing | source order not invoiced directly (INV1 BaseType 17) |

Rules (`HomeDeliveryEligibility`, pure, every doubt blocks): not in the Cheetah map → branch delivery
(supply-approval flow) · consignment → skip · no open lines → skip · order invoiced directly → skip ·
unsigned → wait, alert after `UnsignedAlertDays` · else invoice all open DN lines, dated on the receipt
date (never before the DN date).

Shadow: CSV decision report in `shadow-out\HomeDeliveryInvoicing\<date>\` — nothing is created in SAP.
Faults: missing/unreadable receipt file (never treated as "no deliveries"), file older than
`StaleDatesHours`, unsigned too long, failed invoice post (per DN, does not block others).

Deploy settings (env vars, not committed): `Hub__HomeDelivery__ChitaDatesPath`,
`ConnectionStrings__SapRead` (SQL read login, read-only).

Before going live: confirm the OIG auto-invoice app (currently disabled) and `oig-electra-worker`
do not invoice the same Segment DNs.
