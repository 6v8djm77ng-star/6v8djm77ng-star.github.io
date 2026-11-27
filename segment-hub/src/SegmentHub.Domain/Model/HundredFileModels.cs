namespace SegmentHub.Domain.Model;

/// <summary>One invoice record to be written into the fixed-width "קובץ 100" (ממשק 7, outbound).</summary>
public sealed record InvoiceForHundredFile
{
    public required string InvoiceNumber { get; init; }
    public required DateOnly InvoiceDate { get; init; }
    public required string CustomerCode { get; init; }
    public required string CustomerName { get; init; }
    public required decimal NetAmount { get; init; }
    public required decimal VatAmount { get; init; }
    public required decimal TotalAmount { get; init; }
    public required int SapDocEntry { get; init; }
}
