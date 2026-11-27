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
- **decode** — לפי קידוד שמוגדר per‑interface (Orders=Windows‑1255, SupplyApprovals=UTF‑8).
- **parse** — מבנה הקובץ חי רק במודול. קלט שגוי מחזיר rejection, לא exception.
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
ממומש: **SupplyApprovals** (אישור אספקה → חשבונית), כמודול ייחוס במצב צל.
ממתינים כמודולים: Orders, DeliveryNotes, HundredFile(קובץ 100), PDF/POD, StockLevels, OrderStatus, Returns.

## מה עדיין פתוח (לפני חי)
1. אימות שמות שדות ב‑Service Layer מול המטא‑דאטה החי (DeliveryNotes/Invoices).
2. מפת branch→fatherCard מלאה מ‑`@ESG_CONF` ב‑220.
3. התקנת תהליך שמעתיק קבצים נכנסים ל‑`_HubInbox` (או חיבור SFTP ישיר במקום EasySale).
4. מיגרציית טבלת `HubProcessingLog`.
5. משתמש SAP ייעודי ל‑hub + הרשאות.
