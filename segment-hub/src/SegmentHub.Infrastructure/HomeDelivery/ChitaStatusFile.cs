using Microsoft.Extensions.Logging;
using SegmentHub.Application.Abstractions;

namespace SegmentHub.Infrastructure.HomeDelivery;

/// <summary>Reads oig-electra-worker's state\prod-status.json. Read-only; tolerates the worker rewriting it.</summary>
public sealed class ChitaStatusFile : IChitaStatusSource
{
    private readonly HomeDeliverySettings _settings;
    private readonly ILogger<ChitaStatusFile> _log;

    public ChitaStatusFile(HomeDeliverySettings settings, ILogger<ChitaStatusFile> log)
    {
        _settings = settings;
        _log = log;
    }

    public async Task<ChitaStatusSnapshot?> LoadAsync(CancellationToken ct)
    {
        var path = _settings.StatusFilePath;
        for (var attempt = 1; attempt <= 3; attempt++)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
                {
                    _log.LogWarning("Cheetah status file not found: {Path}", path);
                    return null;
                }
                // FileShare.ReadWrite: never block the worker that owns the file.
                await using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                using var reader = new StreamReader(fs);
                var json = await reader.ReadToEndAsync(ct);
                var snap = ChitaStatusSnapshot.Parse(json, new DateTimeOffset(File.GetLastWriteTimeUtc(path), TimeSpan.Zero));
                if (snap.SkippedEntries > 0)
                    _log.LogWarning("Cheetah status file: {Skipped} malformed entries ignored", snap.SkippedEntries);
                return snap;
            }
            catch (Exception ex) when (ex is IOException or System.Text.Json.JsonException && attempt < 3)
            {
                // Caught mid-rewrite: retry shortly.
                await Task.Delay(TimeSpan.FromSeconds(2), ct);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.Text.Json.JsonException or FormatException)
            {
                _log.LogWarning("Cheetah status file unreadable ({Path}): {Error}", path, ex.Message);
                return null;
            }
        }
        return null;
    }
}
