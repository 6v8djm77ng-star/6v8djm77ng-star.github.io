using System.Globalization;
using System.Text.Json;
using SegmentHub.Domain.Model;

namespace SegmentHub.Application.Abstractions;

/// <summary>
/// Parsed prod-status.json: <c>{"&lt;orderRef&gt;":{"Status":"Delivered","Terminal":true,"DeliveryNote":123,"UpdatedUtc":"..."}}</c>.
/// Malformed entries are dropped (counted), never guessed.
/// </summary>
public sealed class ChitaStatusSnapshot
{
    private readonly Dictionary<string, ChitaShipmentStatus> _byOrder;

    public DateTimeOffset FileWrittenUtc { get; }
    public int SkippedEntries { get; }
    public IReadOnlyCollection<ChitaShipmentStatus> All => _byOrder.Values;

    private ChitaStatusSnapshot(Dictionary<string, ChitaShipmentStatus> map, DateTimeOffset written, int skipped)
    {
        _byOrder = map;
        FileWrittenUtc = written;
        SkippedEntries = skipped;
    }

    public ChitaShipmentStatus? ForOrder(string? orderRef) =>
        orderRef is not null && _byOrder.TryGetValue(orderRef.Trim(), out var s) ? s : null;

    public static ChitaStatusSnapshot Parse(string json, DateTimeOffset fileWrittenUtc)
    {
        var map = new Dictionary<string, ChitaShipmentStatus>(StringComparer.Ordinal);
        var skipped = 0;
        using var doc = JsonDocument.Parse(json);
        if (doc.RootElement.ValueKind != JsonValueKind.Object)
            throw new FormatException("prod-status: root is not an object");

        foreach (var p in doc.RootElement.EnumerateObject())
        {
            var v = p.Value;
            if (v.ValueKind == JsonValueKind.Object
                && v.TryGetProperty("Status", out var st) && st.ValueKind == JsonValueKind.String
                && v.TryGetProperty("Terminal", out var te) && te.ValueKind is JsonValueKind.True or JsonValueKind.False
                && v.TryGetProperty("DeliveryNote", out var dn) && dn.ValueKind == JsonValueKind.Number && dn.TryGetInt32(out var dnNum)
                && v.TryGetProperty("UpdatedUtc", out var up) && up.ValueKind == JsonValueKind.String
                && DateTimeOffset.TryParse(up.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var updated))
                map[p.Name] = new ChitaShipmentStatus(p.Name, st.GetString()!, te.GetBoolean(), dnNum, updated);
            else
                skipped++;
        }
        return new ChitaStatusSnapshot(map, fileWrittenUtc, skipped);
    }
}
