namespace SegmentHub.Domain.Model;

/// <summary>
/// One invoice to report in a "קובץ 100" (ממשק 7). Shape mirrors the EasySale exporter
/// (ESG_SegmentFiles_API HundredFileRow): an Invoice record, then each base delivery note
/// followed by its lines.
/// </summary>
public sealed record HundredFileInvoice
{
    public required int SapDocEntry { get; init; }
    public required string InvoiceNumber { get; init; }       // InvoiceNum (OINV.DocNum)
    public required string SupplierCode { get; init; }        // U_ESG_SupplierCode on BP or father BP
    public required DateOnly InvoiceDate { get; init; }
    public required decimal GrossDocTotal { get; init; }      // sum of invoice line totals
    public required decimal DiscountValue { get; init; }      // OINV.DiscSum
    public required decimal VatSum { get; init; }
    public required string Currency { get; init; }
    public string? CardCode { get; init; }                    // 5-char field; source not confirmed
    public required IReadOnlyList<HundredFileDeliveryNote> DeliveryNotes { get; init; }
}

/// <summary>A base delivery note of the invoice (record type "1").</summary>
public sealed record HundredFileDeliveryNote
{
    public required string CardCode { get; init; }            // store / customer code
    public required string DocNum { get; init; }
    public required DateOnly DocDate { get; init; }
    public string? SupplyApprovalNum { get; init; }          // U_ESG_SupplyApproval
    public string? NumAtCardFromPurchaseOrder { get; init; } // Electra order reference
    public required IReadOnlyList<HundredFileLine> Lines { get; init; }
}

/// <summary>A delivery-note line (record type "2").</summary>
public sealed record HundredFileLine
{
    public string? SubCatalogNum { get; init; }
    public required string ItemCode { get; init; }
    public required decimal Quantity { get; init; }
    public required decimal UnitPrice { get; init; }
    public string? DiscountSum { get; init; }
    public string? OrderLineNum { get; init; }
    public string? DeliveryNoteLineNum { get; init; }
    public string? PurchaseOrderNum { get; init; }
}
