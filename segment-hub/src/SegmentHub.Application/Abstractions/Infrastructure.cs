using SegmentHub.Domain.Model;

namespace SegmentHub.Application.Abstractions;

/// <summary>A queue folder for one interface (incoming / processed / failed), file-system or FTP behind it.</summary>
public interface IFileQueue
{
    /// <summary>Pull the next batch of unprocessed inbound files for a module, oldest first.</summary>
    Task<IReadOnlyList<SegmentFile>> DequeueInboundAsync(string moduleKey, int max, CancellationToken ct);

    /// <summary>Move a handled file to its processed or failed folder, keeping the original name.</summary>
    Task ArchiveAsync(string moduleKey, string fileName, bool succeeded, CancellationToken ct);
}

/// <summary>Durable, queryable record of every processing outcome. Replaces EasySale's silent swallowing.</summary>
public interface IProcessingAuditStore
{
    Task RecordAsync(ProcessingResult result, CancellationToken ct);
}

/// <summary>Compares a shadow-mode result against what EasySale actually did, so we can prove parity before cutover.</summary>
public interface IShadowComparer
{
    Task CompareAsync(ProcessingResult shadowResult, CancellationToken ct);
}

/// <summary>Out-of-band alert (Teams/email). Only for things a human must act on; never for normal rejections.</summary>
public interface IAlertSink
{
    Task RaiseAsync(string title, string body, CancellationToken ct);
}
