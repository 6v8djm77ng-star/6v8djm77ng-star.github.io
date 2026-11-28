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

NOTE: the current `HundredFileGenerator` uses a wrong header/detail/footer layout. It must be
rebuilt to emit these three record types. Still TODO (needs the decompiled assembly + value
formatting logic): record ordering, amount formatting (agora? sign?), date format, how DocType /
SupplyApprovalNum / references are derived.

## ExportDeliveryNotes (ממשק 9) — DeliveryNote_*.txt

Separate export action (`ACTION_TYPE_EXPORT_DELIVERY_NOTE_FILE = "ExportDeliveryNotes"`), file name
prefix `DeliveryNote_`, written to the ExportPath. Observed on 220 as tab-separated ~42 columns.
TODO: capture its exact field mapping from the decompiled `ExportHandler` / build method before
building the module.
