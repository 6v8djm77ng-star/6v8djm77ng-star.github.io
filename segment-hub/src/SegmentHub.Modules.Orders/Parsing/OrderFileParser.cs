using System.Globalization;
using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Enums;
using SegmentHub.Domain.Model;

namespace SegmentHub.Modules.Orders.Parsing;

/// <summary>
/// Parses an Electra order file (ממשק 1). Tab-separated, Windows-1255, no header — 38 columns.
/// The column map mirrors the EasySale importer (ESG_SegmentFiles_API, BuildFileOrderFormFile /
/// BuildOrderItem): one file may hold several orders, grouped by order number (col 1) + customer (col 4).
/// </summary>
public sealed class OrderFileParser : IRecordParser<ElectraOrder>
{
    public const int ExpectedColumns = 38;
    private static readonly char[] LineSeparators = ['\r', '\n'];

    public OneOf<ElectraOrder> Parse(string fileName, string text)
    {
        var orders = ParseAll(fileName, text);
        return orders.Ok
            ? OneOf<ElectraOrder>.Success(orders.Value![0])
            : OneOf<ElectraOrder>.Reject(orders.Rejection!.Code, orders.Rejection.Message);
    }

    public OneOf<IReadOnlyList<ElectraOrder>> ParseAll(string fileName, string text)
    {
        var rows = text.Split(LineSeparators, StringSplitOptions.RemoveEmptyEntries);
        if (rows.Length == 0)
            return OneOf<IReadOnlyList<ElectraOrder>>.Reject(RejectionCode.MalformedFile, "קובץ הזמנות ריק");

        // Preserve first-seen order of groups; key = orderNumber (col1) + customer (col4).
        var order = new List<string>();
        var groups = new Dictionary<string, List<string[]>>();

        foreach (var raw in rows)
        {
            var cols = raw.Split('\t');
            if (cols.Length != ExpectedColumns)
                return OneOf<IReadOnlyList<ElectraOrder>>.Reject(RejectionCode.WrongColumnCount,
                    $"צפויות {ExpectedColumns} עמודות, התקבלו {cols.Length}");

            var orderNum = cols[1].Trim();
            if (string.IsNullOrEmpty(orderNum))
                return OneOf<IReadOnlyList<ElectraOrder>>.Reject(RejectionCode.MalformedFile, "מספר הזמנה ריק");

            var key = orderNum + "|" + cols[4].Trim();
            if (!groups.TryGetValue(key, out var list))
            {
                list = [];
                groups[key] = list;
                order.Add(key);
            }
            list.Add(cols);
        }

        var result = new List<ElectraOrder>(order.Count);
        foreach (var key in order)
        {
            var rowsForOrder = groups[key];
            var head = rowsForOrder[0];

            if (!TryDate(head[5], out var docDate))
                return OneOf<IReadOnlyList<ElectraOrder>>.Reject(RejectionCode.MalformedFile,
                    $"תאריך מסמך לא חוקי '{head[5]}' בהזמנה {head[1].Trim()}");
            if (!TryDate(head[6], out var dueDate))
                return OneOf<IReadOnlyList<ElectraOrder>>.Reject(RejectionCode.MalformedFile,
                    $"תאריך אספקה לא חוקי '{head[6]}' בהזמנה {head[1].Trim()}");

            var lines = new List<ElectraOrderLine>(rowsForOrder.Count);
            foreach (var c in rowsForOrder)
            {
                if (!TryDec(c[18], out var qty))
                    return OneOf<IReadOnlyList<ElectraOrder>>.Reject(RejectionCode.MalformedFile,
                        $"כמות לא חוקית '{c[18]}' בהזמנה {head[1].Trim()}");
                if (!TryDec(c[21], out var unitPrice))
                    return OneOf<IReadOnlyList<ElectraOrder>>.Reject(RejectionCode.MalformedFile,
                        $"מחיר יחידה לא חוקי '{c[21]}' בהזמנה {head[1].Trim()}");
                if (!TryDec(c[23], out var lineTotal))
                    return OneOf<IReadOnlyList<ElectraOrder>>.Reject(RejectionCode.MalformedFile,
                        $"סכום שורה לא חוקי '{c[23]}' בהזמנה {head[1].Trim()}");

                lines.Add(new ElectraOrderLine
                {
                    ItemCode = c[13].Trim(),
                    Description = c[14].Trim(),
                    Barcode = c[16].Trim(),
                    LineNumber = Int(c[17]),
                    Quantity = qty,
                    CurrencyCode = Int(c[20]),
                    UnitPrice = unitPrice,
                    LineTotal = lineTotal,
                    FreeText = c[25].Trim(),
                    RawColumns = c
                });
            }

            result.Add(new ElectraOrder
            {
                SourceFileName = fileName,
                FatherCard = head[0].Trim(),
                OrderNumber = head[1].Trim(),
                CardCode = head[4].Trim(),
                OrderDate = docDate,
                DeliveryDate = dueDate,
                PriceWithoutVat = Dec(head[8]),
                Comments = head[11].Trim(),
                ClientAddress = BuildClientAddress(head),
                Lines = lines
            });
        }

        return OneOf<IReadOnlyList<ElectraOrder>>.Success(result);
    }

    /// <summary>B2C delivery address, composed exactly as the EasySale importer does for ImportOrder.</summary>
    private static string BuildClientAddress(string[] c)
    {
        var v27 = c[27].Trim();
        var v29 = c[29].Trim();
        var v30 = c[30].Trim();
        var v31 = c[31].Trim();
        var v32 = c[32].Trim();
        var v33 = c[33].Trim();
        if ((v27 + v29 + v30 + v31 + v32 + v33).Length == 0) return "";
        return $"{v29} {v30},{v27} , {v33} , {v31} , {v32}";
    }

    private static bool TryDate(string s, out DateOnly d) =>
        DateOnly.TryParseExact(s.Trim(), "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out d);

    private static decimal Dec(string s) =>
        decimal.TryParse(s.Trim(), NumberStyles.Number, CultureInfo.InvariantCulture, out var v) ? v : 0m;

    private static bool TryDec(string s, out decimal v) =>
        decimal.TryParse(s.Trim(), NumberStyles.Number, CultureInfo.InvariantCulture, out v);

    private static int Int(string s) =>
        int.TryParse(s.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) ? v : 0;
}
