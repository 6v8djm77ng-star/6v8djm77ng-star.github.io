using Microsoft.Extensions.Options;
using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Model;
using SegmentHub.Infrastructure.Configuration;

namespace SegmentHub.Infrastructure.Files;

/// <summary>
/// File-system queue over the EasySale-compatible folder tree. During shadow mode it reads from a COPY
/// folder so it never competes with EasySale for the live files — the exact mistake behind the incident.
/// Reads use FileShare.ReadWrite so an open file is never locked out.
/// </summary>
public sealed class FileSystemQueue : IFileQueue
{
    private readonly QueueOptions _opt;
    public FileSystemQueue(IOptions<HubOptions> opt) => _opt = opt.Value.Queue;

    public async Task<IReadOnlyList<SegmentFile>> DequeueInboundAsync(string moduleKey, int max, CancellationToken ct)
    {
        var inbox = Path.Combine(_opt.RootPath, moduleKey, "_HubInbox");
        if (!Directory.Exists(inbox)) return [];

        var files = new DirectoryInfo(inbox)
            .EnumerateFiles("*.txt")
            .OrderBy(f => f.LastWriteTimeUtc)
            .Take(max);

        var result = new List<SegmentFile>();
        foreach (var f in files)
        {
            ct.ThrowIfCancellationRequested();
            var bytes = await ReadSharedAsync(f.FullName, ct);
            result.Add(new SegmentFile(f.Name, bytes, f.LastWriteTimeUtc));
        }
        return result;
    }

    public Task ArchiveAsync(string moduleKey, string fileName, bool succeeded, CancellationToken ct)
    {
        var inbox = Path.Combine(_opt.RootPath, moduleKey, "_HubInbox");
        var target = Path.Combine(_opt.RootPath, moduleKey, succeeded ? "_HubDone" : "_HubFailed");
        Directory.CreateDirectory(target);
        var src = Path.Combine(inbox, fileName);
        if (File.Exists(src))
            File.Move(src, Path.Combine(target, fileName), overwrite: true);
        return Task.CompletedTask;
    }

    private static async Task<byte[]> ReadSharedAsync(string path, CancellationToken ct)
    {
        await using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        using var ms = new MemoryStream();
        await fs.CopyToAsync(ms, ct);
        return ms.ToArray();
    }
}
