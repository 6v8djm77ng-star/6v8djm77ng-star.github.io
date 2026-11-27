using Microsoft.Extensions.Logging;
using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Enums;
using SegmentHub.Domain.Model;

namespace SegmentHub.Infrastructure.Persistence;

/// <summary>
/// Shadow-mode comparer. First cut: logs what the hub WOULD have done so it can be diffed against
/// EasySale's own output for the same files. The production version will read EasySale's result
/// (invoice created? rejected?) and record agree/disagree per file, which is the gate for cutover.
/// </summary>
public sealed class LoggingShadowComparer : IShadowComparer
{
    private readonly ILogger<LoggingShadowComparer> _log;
    public LoggingShadowComparer(ILogger<LoggingShadowComparer> log) => _log = log;

    public Task CompareAsync(ProcessingResult r, CancellationToken ct)
    {
        var verdict = r.Status switch
        {
            ProcessingStatus.Succeeded => $"WOULD-INVOICE {r.CreatedSapDocType}",
            ProcessingStatus.Rejected => $"WOULD-REJECT {r.Rejection}",
            _ => $"FAULT {r.FaultDetail}"
        };
        _log.LogInformation("SHADOW[{Module}] {File} => {Verdict}", r.ModuleKey, r.SourceFileName, verdict);
        return Task.CompletedTask;
    }
}
