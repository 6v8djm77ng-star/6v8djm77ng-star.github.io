# Outbound file formats (reverse-engineered from EasySale ESG_SegmentFiles_API)

Authoritative layout captured from the decompiled EasySale importer/exporter. Field names and
widths only — no production data. Used to rebuild the outbound modules correctly.

## קובץ 100 (ממשק 7) — fixed-width, 100 chars/record, Windows-1255

A single file mixes three record types, keyed by the leading RecordType digit. Widths per field;
each record sums to exactly 100.

### Invoice record — RecordType "0"
| field | width |
|---|---|
| RecordType ("0") | 1 |
| CardCode | 5 |
| SupplierCode | 10 |
| InvoiceDate | 6 |
| InvoiceNum | 10 |
| GrossDocTotal | 12 |
| DiscountValue | 12 |
| PromotionDiscount | 12 |
| RoundDocTotal | 4 |
| FILLER73_80 | 8 |
| VatSum | 12 |
| Currency | 3 |
| FILLER96_100 | 5 |

### DeliveryNote record — RecordType "1"
| field | width |
|---|---|
| RecordType ("1") | 1 |
| CardCode | 10 |
| DocNum | 10 |
| DocType | 1 |
| DocDate | 6 |
| SupplyApprovalNum | 10 |
| GrossDocTotal | 9 |
| FILLER48_71 | 24 |
| Reference2 | 15 |
| NumAtCardFromPurchaseOrder | 11 |
| FILLER98_100 | 3 |

### Line record — RecordType "2"
| field | width |
|---|---|
| RecordType ("2") | 1 |
| SubCatalogNum | 13 |
| ItemCode | 13 |
| UnitsOrPackages | 1 |
| UnitsQuantity | 7 |
| QtyPerPackage | 3 |
| PackagesQuantity | 3 |
| UnitPrice | 11 |
| DiscountSum | 9 |
| FILLER62_79 | 18 |
| OrderLineNum | 5 |
| DeliveryNoteLineNum | 5 |
| PurchaseOrderNum | 11 |

### Formatting rules (confirmed from EasySale code)
- Every field: `value.PadLeft(width, '0')`; empty/unset field → all zeros (fillers too).
- Dates: `yyMMdd`. InvoiceNum/DocNum: plain integer text.
- GrossDocTotal / DiscountValue: `"0.00"`; VatSum and line UnitsQuantity: `".00"`; line UnitPrice: `"000000.0000"`.
- DocType = `"1"` for Segment invoices; line UnitsOrPackages = `"0"`.
- Record order (OrderByDeliveryNotes): Invoice record, then per base delivery note its DN record followed by its lines. CRLF after every record. No footer.
- Sent flag: `OINV.U_ESG_100FileCreated` (existing EasySale field).

### Implementation status — IMPLEMENTED (`HundredFileGenerator`, `HundredFileModule`)
Layout and formatting are exact and unit-tested. Data sourcing (Service Layer) follows the
decompiled SQL where it was visible; these are ASSUMPTIONS to confirm by diff:
- NumAtCardFromPurchaseOrder = DN.NumAtCard · SubCatalogNum = line.SupplierCatNum ·
  UnitPrice = line.UnitPrice (pre-discount) · DeliveryNoteLineNum = line.BaseLine · sent value `'Y'`.
- DiscountSum, OrderLineNum, PurchaseOrderNum, Reference2, invoice CardCode: left at zero default.
- Discount field is written only when non-zero (EasySale sets it conditionally).
- File name `100_{InvoiceNum}.txt` (EasySale's own naming not captured).
- Credit memos (negative amounts) are refused explicitly, not emitted.

### How to verify (shadow mode)
Shadow writes each invoice's file to `C:\OIG-Monitor\segment-hub\shadow-out\HundredFile\<date>\`
(outside the EasySale tree, so WinSCP can never upload it). Compare it byte-for-byte with the
file EasySale sent for the same invoice; any differing column points at exactly one assumption above.

## ExportDeliveryNotes (ממשק 9) — DeliveryNote_*.txt

Separate export action (`ACTION_TYPE_EXPORT_DELIVERY_NOTE_FILE = "ExportDeliveryNotes"`), file name
prefix `DeliveryNote_`, written to the ExportPath. Observed on 220 as tab-separated ~42 columns.
TODO: capture its exact field mapping from the decompiled `ExportHandler` / build method before
building the module.
