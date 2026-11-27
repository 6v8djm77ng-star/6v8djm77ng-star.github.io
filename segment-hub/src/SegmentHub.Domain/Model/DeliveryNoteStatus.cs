using SegmentHub.Domain.Enums;

namespace SegmentHub.Domain.Model;

/// <summary>One parsed line of a Delivery Note status file (ממשק 9). 42 tab columns, UTF-8-BOM.</summary>
public sealed record DeliveryNoteStatusLine
{
    public required string SupplierCode { get; init; }        // c0
    public required string BranchCode { get; init; }          // c1
    public required DocumentKey DeliveryNoteRef { get; init; } // c2
    public required DocumentKey OrderRef { get; init; }        // c3
    public required DateOnly ActionDate { get; init; }         // c4  yyyyMMdd
    public required DeliveryNoteAction Action { get; init; }   // c5
    public required string ItemCode { get; init; }             // c6
    public required decimal Quantity { get; init; }            // c7
    public required decimal ReceivedQuantity { get; init; }    // c8
    public string? Remark { get; init; }                       // c9
    public required string StatusCode { get; init; }           // c10
    public required string[] RawColumns { get; init; }
}

/// <summary>A delivery note status file: all lines parsed from one inbound file.</summary>
public sealed record DeliveryNoteStatusFile
{
    public required string SourceFileName { get; init; }
    public required string SupplierCode { get; init; }
    public required IReadOnlyList<DeliveryNoteStatusLine> Lines { get; init; }

    public DocumentKey DeliveryNoteRef => Lines.Count > 0 ? Lines[0].DeliveryNoteRef : default;
}
