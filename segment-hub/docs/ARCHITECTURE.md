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

**Why:** read-only SAP checks (28.11.2026) show every Segment home-delivery invoice in the last 90 days
was created by hand (48/48, none via a supply approval), so EasySale — and the SupplyApprovals module —
never cover them. A forgotten delivery stays un-billed for weeks (two such DNs were open 30+ days).

**Delivery signal:** reused from `oig-electra-worker` (`state\prod-status.json`, keyed by Electra order
ref = DN.NumAtCard, with Status / Terminal / DeliveryNote / UpdatedUtc). The hub never calls Cheetah.

Rules (`HomeDeliveryEligibility`, pure, every doubt blocks): not in the status file → branch delivery ·
status points to another DN → alert, never bill · Refuse → alert, never bill · consignment / no open
lines / order invoiced directly → skip · not Delivered → in transit (alert after `InTransitAlertDays`) ·
Delivered → invoice all open DN lines, dated on the local day Cheetah confirmed (never before the DN date).

Faults: missing/unreadable status file (never "nothing delivered"); no status change for
`StaleStatusHours` while shipments are in transit (= Cheetah link down; 72h so a quiet weekend does not alert);
refused / key mismatch / long in transit; failed invoice post (per DN, does not block others).

**Status: disabled by default.** Enable in shadow where the status file is readable (the VM), with
`Hub__HomeDelivery__StatusFilePath`, `ConnectionStrings__SapRead`, and compare the CSV report with the
manual invoices before going live. Then the manual process must stop, or invoices will be duplicated
(the open-lines guard blocks a second invoice only if the manual one was drawn from the DN).
