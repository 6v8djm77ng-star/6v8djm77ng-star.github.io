using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SegmentHub.Application.Abstractions;
using SegmentHub.Infrastructure.Configuration;

namespace SegmentHub.Infrastructure.Files;

/// <summary>
/// Writes outbound files to the Segment pickup folder and archives a dated copy.
/// </summary>
public sealed class OutboundFilePublisher : IFilePublisher
{
    private readonly QueueOptions _opt;
    private readonly ILogger<OutboundFilePublisher> _log;

    public OutboundFilePublisher(IOptions<HubOptions> opt, ILogger<OutboundFilePublisher> log)
    {
        _opt = opt.Value.Queue;
        _log = log;
    }

    public async Task PublishAsync(string moduleKey, string fileName, byte[] content, CancellationToken ct)
    {
        var outbox = Path.Combine(_opt.RootPath, moduleKey, "_HubOutbox");
        Directory.CreateDirectory(outbox);

        var targetPath = Path.Combine(outbox, fileName);
        await WriteSharedAsync(targetPath, content, ct);

        var archiveDir = Path.Combine(_opt.RootPath, moduleKey, "_HubOutboxDone",
            DateTime.UtcNow.ToString("yyyy-MM-dd"));
        Directory.CreateDirectory(archiveDir);
        var archivePath = Path.Combine(archiveDir, fileName);
        await WriteSharedAsync(archivePath, content, ct);

        _log.LogInformation("Published {Module}/{File} ({Bytes} bytes)", moduleKey, fileName, content.Length);
    }

    public async Task WriteShadowCopyAsync(string moduleKey, string fileName, byte[] content, CancellationToken ct)
    {
        var dir = Path.Combine(_opt.ShadowOutputPath, moduleKey, DateTime.Now.ToString("yyyy-MM-dd"));
        Directory.CreateDirectory(dir);
        await WriteSharedAsync(Path.Combine(dir, fileName), content, ct);
        _log.LogInformation("SHADOW copy {Module}/{File} -> {Dir}", moduleKey, fileName, dir);
    }

    private static async Task WriteSharedAsync(string path, byte[] content, CancellationToken ct)
    {
        await using var fs = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.ReadWrite);
        await fs.WriteAsync(content, ct);
    }
}
