using SegmentHub.Domain.Enums;

namespace SegmentHub.Domain.Model;

/// <summary>Raw inbound Segment file as pulled from a queue folder. Content is bytes until decoded.</summary>
public sealed record SegmentFile(string Name, byte[] Content, DateTimeOffset ReceivedAt)
{
    public long Length => Content.LongLength;
}

/// <summary>One parsed line of a Supply Approval (ממשק 11, Entry_* file). 17 tab columns as observed on 220.</summary>
public sealed record SupplyApprovalLine
{
    public required string SupplierCode { get; init; }      // c1  - 600060078 (constant)
    public required string BranchCode { get; init; }        // c2  - 3-digit branch
    public required string ApprovalNumber { get; init; }    // c3  - 8-digit Segment approval id
    public required DateOnly ApprovalDate { get; init; }     // c4  - yyyyMMdd
    public required DocumentKey DeliveryNoteRef { get; init; } // c5  - DN (200xxxx) or invoice (109xxxx)
    public required DocumentKey ElectraOrderRef { get; init; } // c6  - Electra order (103.../999...)
    public required decimal UnitPrice { get; init; }        // c8
    public required decimal Quantity { get; init; }         // c9
    public required int ProductType { get; init; }          // c12 - 0..4
    public required decimal LineTotal { get; init; }        // c16
    public required string[] RawColumns { get; init; }      // full verbatim row for audit
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
