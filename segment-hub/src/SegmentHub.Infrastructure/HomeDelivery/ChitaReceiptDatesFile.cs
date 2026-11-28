using Microsoft.Extensions.Logging;
using SegmentHub.Application.Abstractions;

namespace SegmentHub.Infrastructure.HomeDelivery;

/// <summary>Reads chita-receipt-dates.json (written by the existing Cheetah Daily job). Read-only.</summary>
public sealed class ChitaReceiptDatesFile : IChitaReceiptDatesSource
{
    private readonly HomeDeliverySettings _settings;
    private readonly ILogger<ChitaReceiptDatesFile> _log;

    public ChitaReceiptDatesFile(HomeDeliverySettings settings, ILogger<ChitaReceiptDatesFile> log)
    {
        _settings = settings;
        _log = log;
    }

    public async Task<ChitaReceiptDates?> LoadAsync(CancellationToken ct)
    {
        var path = _settings.ChitaDatesPath;
        try
        {
            if (!File.Exists(path))
            {
                _log.LogWarning("Chita receipt-dates file not found: {Path}", path);
                return null;
            }
            var json = await File.ReadAllTextAsync(path, ct);
            var dates = ChitaReceiptDates.Parse(json, new DateTimeOffset(File.GetLastWriteTimeUtc(path), TimeSpan.Zero));
            if (dates.SkippedEntries > 0)
                _log.LogWarning("Chita receipt-dates: {Skipped} malformed entries ignored", dates.SkippedEntries);
            return dates;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.Text.Json.JsonException or FormatException)
        {
            _log.LogWarning("Chita receipt-dates unreadable ({Path}): {Error}", path, ex.Message);
            return null;
        }
    }
}
