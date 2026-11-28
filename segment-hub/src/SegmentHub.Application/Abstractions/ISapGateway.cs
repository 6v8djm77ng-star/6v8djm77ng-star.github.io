using SegmentHub.Domain.Enums;
using SegmentHub.Domain.Model;

namespace SegmentHub.Application.Abstractions;

/// <summary>
/// The only door to SAP Business One. One implementation (Service Layer) in Infrastructure.
/// Everything is explicit so the pipeline can decide, not guess. In shadow mode the writing
/// methods are never called — the gateway is used read-only to verify linkage.
/// </summary>
public interface ISapGateway
{
    /// <summary>
    /// Find the open delivery note whose DocNum matches the normalized key, for the given customer group.
    /// This is the robust linkage that EasySale lacked. Returns null when there is genuinely no match.
    /// </summary>
    Task<DeliveryNoteHandle?> FindOpenDeliveryNoteAsync(DocumentKey deliveryNoteRef, string customerFatherCard, CancellationToken ct);

    /// <summary>True if an item code exists and is active in SAP (prevents "פריט לא קיים" faults).</summary>
    Task<bool> ItemExistsAsync(string itemCode, CancellationToken ct);

    /// <summary>
    /// Create an A/R invoice from ALL open lines of an existing delivery note. Returns the new DocEntry.
    /// Throws when the DN has no open line (already invoiced) — never posts a partial or empty invoice.
    /// </summary>
    Task<int> CreateInvoiceFromDeliveryNoteAsync(InvoiceDraft draft, CancellationToken ct);

    /// <summary>True if a sales order with this Electra reference already exists (duplicate guard).</summary>
    Task<bool> SalesOrderExistsAsync(string electraOrderRef, string fatherCard, CancellationToken ct);

    /// <summary>Create a sales order in SAP. Returns the new DocEntry.</summary>
    Task<int> CreateSalesOrderAsync(SalesOrderDraft draft, CancellationToken ct);

    /// <summary>עדכון סטטוס תעודת משלוח ב-SAP לפי דיווח אלקטרה (ממשק 9).</summary>
    Task UpdateDeliveryNoteStatusAsync(int docEntry, DeliveryNoteAction action, CancellationToken ct);

    /// <summary>
    /// Segment invoices for "קובץ 100" (ממשק 7, outbound) in a date range, with their base delivery notes
    /// and lines. <paramref name="includeReported"/> = true also returns invoices already flagged as sent
    /// (used in shadow mode to compare against EasySale's output).
    /// </summary>
    Task<IReadOnlyList<HundredFileInvoice>> GetPendingHundredFileInvoicesAsync(
        DateOnly from, DateOnly to, bool includeReported, CancellationToken ct);

    /// <summary>Flag invoices as reported (U_ESG_100FileCreated, the field EasySale already uses).</summary>
    Task MarkInvoicesAsReportedAsync(IReadOnlyList<int> sapDocEntries, CancellationToken ct);
}

/// <summary>Lightweight handle to a delivery note found in SAP.</summary>
public sealed record DeliveryNoteHandle(int DocEntry, int DocNum, string CardCode, bool IsOpen);

/// <summary>
/// What we intend to post. Built by a mapper, validated before it reaches the gateway.
/// <paramref name="DocDate"/> null = SAP default (today); home deliveries use the Cheetah receipt date.
/// </summary>
public sealed record InvoiceDraft(
    int BaseDeliveryNoteDocEntry, string CardCode, string SourceFileName, decimal ExpectedTotal, DateOnly? DocDate = null);

/// <summary>Sales order draft ready to post to SAP.</summary>
public sealed record SalesOrderDraft
{
    public required string CardCode { get; init; }
    public required string ElectraOrderRef { get; init; }
    public required DateOnly OrderDate { get; init; }
    public required DateOnly DeliveryDate { get; init; }
    public required string SourceFileName { get; init; }
    public required IReadOnlyList<SalesOrderLineDraft> Lines { get; init; }
    /// <summary>B2C delivery address; null for a branch (B2B) order.</summary>
    public string? ClientAddress { get; init; }
    public bool IsHomeDelivery { get; init; }
}

public sealed record SalesOrderLineDraft
{
    public required string ItemCode { get; init; }
    public required string Description { get; init; }
    public required decimal Quantity { get; init; }
    public required decimal UnitPrice { get; init; }
    public required int LineNumber { get; init; }
    public string? Barcode { get; init; }
    public string? FreeText { get; init; }
}
