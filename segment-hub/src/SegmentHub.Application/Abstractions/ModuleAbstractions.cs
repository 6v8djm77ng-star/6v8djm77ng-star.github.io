using SegmentHub.Domain.Enums;
using SegmentHub.Domain.Model;

namespace SegmentHub.Application.Abstractions;

/// <summary>
/// One Segment interface (Orders, SupplyApprovals, DeliveryNotes, HundredFile, ...). SOLID: each module
/// owns its own parse/validate/map steps and is otherwise driven by the same generic pipeline and host.
/// Adding an interface = adding a module, not touching the engine.
/// </summary>
public interface ISegmentModule
{
    /// <summary>Stable id, e.g. "SupplyApprovals". Used for config, queue folder and logging scope.</summary>
    string Key { get; }

    InterfaceDirection Direction { get; }

    /// <summary>Process a single inbound file end to end and return an auditable result.</summary>
    Task<ProcessingResult> ProcessInboundAsync(SegmentFile file, bool shadowMode, CancellationToken ct);
}

/// <summary>Decodes raw bytes into text using the interface's declared encoding (UTF-8, Windows-1255, ...).</summary>
public interface IFileDecoder
{
    string Decode(byte[] content, string encodingName);
}

/// <summary>Parses decoded text into a typed domain object. Throws nothing on bad data — returns a rejection.</summary>
public interface IRecordParser<T>
{
    OneOf<T> Parse(string fileName, string text);
}

/// <summary>Business validation against SAP state. Returns the first blocking reason, or null if valid.</summary>
public interface IRecordValidator<T>
{
    Task<RejectionReason?> ValidateAsync(T record, CancellationToken ct);
}

/// <summary>Maps a validated domain object to a SAP draft ready to post.</summary>
public interface IDocumentMapper<T, TDraft>
{
    Task<TDraft> MapAsync(T record, CancellationToken ct);
}

/// <summary>Minimal success-or-rejection result for parsing, avoiding exceptions for expected bad input.</summary>
public readonly struct OneOf<T>
{
    public T? Value { get; }
    public RejectionReason? Rejection { get; }
    public bool Ok => Rejection is null;

    private OneOf(T? value, RejectionReason? rejection) { Value = value; Rejection = rejection; }
    public static OneOf<T> Success(T value) => new(value, null);
    public static OneOf<T> Reject(RejectionCode code, string msg) => new(default, new RejectionReason(code, msg));
}
