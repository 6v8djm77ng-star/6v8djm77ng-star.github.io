using SegmentHub.Domain.Enums;

namespace SegmentHub.Domain.Model;

/// <summary>Raw inbound Segment file as pulled from a queue folder. Content is bytes until decoded.</summary>
public sealed record SegmentFile(string Name, byte[] Content, DateTimeOffset ReceivedAt)
{
    public long Length => Content.LongLength;
}

/// <summary>
/// One parsed line of a Supply Approval (ממשק 11, Entry_* file). Column indices mirror the EasySale
/// importer (ESG_SegmentFiles_API, BuildFileSupplyApprovalFormFile / BuildSupplyApprovalItem):
/// tab-separated, Windows-1255, no header.
/// </summary>
public sealed record SupplyApprovalLine
{
    public required string SupplierCode { get; init; }         // [0]  - 600060078 (constant, unused by import)
    public required string CardCode { get; init; }             // [1]  - customer business partner
    public required string ApprovalNumber { get; init; }       // [2]  - Segment approval id
    public required DateOnly ApprovalDate { get; init; }        // [3]  - yyyyMMdd (DocDate)
    public required DocumentKey DeliveryNoteRef { get; init; }  // [4]  - linked DN DocNum
    public required string NumAtCard { get; init; }            // [5]  - grouping key
    public required string ItemCode { get; init; }             // [9]
    public required string Barcode { get; init; }              // [10]
    public required int LineNumber { get; init; }              // [11]
    public required decimal Quantity { get; init; }            // [12]
    public required decimal UnitPrice { get; init; }           // [15]
    public required string[] RawColumns { get; init; }         // full verbatim row for audit

    /// <summary>Line total derived from quantity x unit price (the file has no explicit total).</summary>
    public decimal LineTotal => Quantity * UnitPrice;
}

/// <summary>A Supply Approval document: the header plus its lines, parsed from one Entry_* file.</summary>
public sealed record SupplyApproval
{
    public required string SourceFileName { get; init; }
    public required string SupplierCode { get; init; }
    public required IReadOnlyList<SupplyApprovalLine> Lines { get; init; }

    /// <summary>The DN the whole approval settles. All lines must reference the same one.</summary>
    public DocumentKey DeliveryNoteRef => Lines.Count > 0 ? Lines[0].DeliveryNoteRef : default;
}

/// <summary>Why a record was rejected. Always has a code and a human sentence (Hebrew-capable).</summary>
public sealed record RejectionReason(RejectionCode Code, string Message)
{
    public override string ToString() => $"[{(int)Code} {Code}] {Message}";
}

/// <summary>Outcome of processing one unit of work. Immutable; carries evidence for the audit log.</summary>
public sealed record ProcessingResult
{
    public required string SourceFileName { get; init; }
    public string ModuleKey { get; init; } = "unknown";
    public required ProcessingStatus Status { get; init; }
    public RejectionReason? Rejection { get; init; }
    public string? CreatedSapDocType { get; init; }
    public int? CreatedSapDocEntry { get; init; }
    public string? FaultDetail { get; init; }
    public bool ShadowMode { get; init; }

    public static ProcessingResult Ok(string file, string? docType = null, int? docEntry = null, bool shadow = false) =>
        new() { SourceFileName = file, Status = ProcessingStatus.Succeeded, CreatedSapDocType = docType, CreatedSapDocEntry = docEntry, ShadowMode = shadow };

    public static ProcessingResult Reject(string file, RejectionReason reason, bool shadow = false) =>
        new() { SourceFileName = file, Status = ProcessingStatus.Rejected, Rejection = reason, ShadowMode = shadow };

    public static ProcessingResult Fault(string file, string detail, bool shadow = false) =>
        new() { SourceFileName = file, Status = ProcessingStatus.Faulted, FaultDetail = detail, ShadowMode = shadow };
}
