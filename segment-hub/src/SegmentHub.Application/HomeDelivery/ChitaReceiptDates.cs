using System.Globalization;
using System.Text.Json;

namespace SegmentHub.Application.Abstractions;

/// <summary>
/// Parsed chita-receipt-dates.json: <c>{"OIG":{"&lt;orderDocNum&gt;":"yyyy-MM-dd"},"UNICO":{...}}</c>.
/// Malformed entries are dropped (counted), never guessed.
/// </summary>
public sealed class ChitaReceiptDates
{
    private readonly Dictionary<string, Dictionary<int, DateOnly>> _byCompany;

    public DateTimeOffset LastWriteUtc { get; }
    public int SkippedEntries { get; }

    private ChitaReceiptDates(Dictionary<string, Dictionary<int, DateOnly>> map, DateTimeOffset lastWriteUtc, int skipped)
    {
        _byCompany = map;
        LastWriteUtc = lastWriteUtc;
        SkippedEntries = skipped;
    }

    public DateOnly? ReceiptDate(string company, int orderDocNum) =>
        _byCompany.TryGetValue(company, out var m) && m.TryGetValue(orderDocNum, out var d) ? d : null;

    public static ChitaReceiptDates Parse(string json, DateTimeOffset lastWriteUtc)
    {
        var map = new Dictionary<string, Dictionary<int, DateOnly>>(StringComparer.OrdinalIgnoreCase);
        var skipped = 0;
        using var doc = JsonDocument.Parse(json);
        if (doc.RootElement.ValueKind != JsonValueKind.Object)
            throw new FormatException("chita-receipt-dates: root is not an object");

        foreach (var company in doc.RootElement.EnumerateObject())
        {
            if (company.Value.ValueKind != JsonValueKind.Object) { skipped++; continue; }
            var dates = new Dictionary<int, DateOnly>();
            foreach (var entry in company.Value.EnumerateObject())
            {
                if (int.TryParse(entry.Name, NumberStyles.None, CultureInfo.InvariantCulture, out var docNum)
                    && entry.Value.ValueKind == JsonValueKind.String
                    && DateOnly.TryParseExact(entry.Value.GetString(), "yyyy-MM-dd", CultureInfo.InvariantCulture,
                        DateTimeStyles.None, out var date))
                    dates[docNum] = date;
                else
                    skipped++;
            }
            map[company.Name] = dates;
        }
        return new ChitaReceiptDates(map, lastWriteUtc, skipped);
    }
}
