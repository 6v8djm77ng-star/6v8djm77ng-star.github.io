using System.Globalization;
using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Enums;
using SegmentHub.Domain.Model;

namespace SegmentHub.Modules.Orders.Parsing;

/// <summary>
/// Parses an Electra order file (ממשק 1). 38 tab-separated columns, Windows-1255.
/// One file may contain multiple orders (grouped by OrderNumber, c2).
/// Returns a list of ElectraOrder per unique OrderNumber.
/// </summary>
public sealed class OrderFileParser : IRecordParser<ElectraOrder>
{
    public const int ExpectedColumns = 38;
    private static readonly char[] LineSeparators = ['\r', '\n'];

    /// <summary>
    /// Parses the file. Since one file can contain multiple orders, we return the FIRST order.
    /// For multi-order files, the host should call ParseAll and loop.
    /// </summary>
    public OneOf<ElectraOrder> Parse(string fileName, string text)
    {
        var orders = ParseAll(fileName, text);
        return orders.Ok ? OneOf<ElectraOrder>.Success(orders.Value![0]) : OneOf<ElectraOrder>.Reject(orders.Rejection!.Code, orders.Rejection.Message);
    }

    public OneOf<IReadOnlyList<ElectraOrder>> ParseAll(string fileName, string text)
    {
        var rows = text.Split(LineSeparators, StringSplitOptions.RemoveEmptyEntries);
        if (rows.Length == 0)
            return OneOf<IReadOnlyList<ElectraOrder>>.Reject(RejectionCode.MalformedFile, "קובץ הזמנות ריק");

        var grouped = new Dictionary<string, List<(string[] Cols, string HeaderBranch, DateOnly OrderDate, DateOnly DeliveryDate,
            string CustName, string CustPhone, string CustAddr, string CustCity, string DelBranch)>>();

        foreach (var row in rows)
        {
            var cols = row.Split('\t');
            if (cols.Length != ExpectedColumns)
                return OneOf<IReadOnlyList<ElectraOrder>>.Reject(RejectionCode.WrongColumnCount,
                    $"צפויות {ExpectedColumns} עמודות, התקבלו {cols.Length}");

            var orderNum = cols[2].Trim();
            if (string.IsNullOrEmpty(orderNum))
                return OneOf<IReadOnlyList<ElectraOrder>>.Reject(RejectionCode.MalformedFile, "מספר הזמנה ריק");

            if (!TryDate(cols[3], out var orderDate))
                return OneOf<IReadOnlyList<ElectraOrder>>.Reject(RejectionCode.MalformedFile, $"תאריך הזמנה לא חוקי '{cols[3]}'");

            if (!TryDate(cols[4], out var deliveryDate))
                return OneOf<IReadOnlyList<ElectraOrder>>.Reject(RejectionCode.MalformedFile, $"תאריך אספקה לא חוקי '{cols[4]}'");

            if (!grouped.ContainsKey(orderNum))
                grouped[orderNum] = [];

            grouped[orderNum].Add((cols, cols[1].Trim(), orderDate, deliveryDate,
                cols[14].Trim(), cols[15].Trim(), cols[16].Trim(), cols[17].Trim(), cols[18].Trim()));
        }

        var orders = new List<ElectraOrder>(grouped.Count);
        foreach (var (orderNum, lineData) in grouped)
        {
            var first = lineData[0];
            var lines = new List<ElectraOrderLine>(lineData.Count);
            foreach (var ld in lineData)
            {
                lines.Add(new ElectraOrderLine
                {
                    ItemCode = ld.Cols[5].Trim(),
                    Description = ld.Cols[6].Trim(),
                    Quantity = Dec(ld.Cols[7]),
                    UnitPrice = Dec(ld.Cols[8]),
                    Discount = Dec(ld.Cols[9]),
                    LineTotal = Dec(ld.Cols[10]),
                    ColorCode = ld.Cols[11].Trim(),
                    SizeCode = ld.Cols[12].Trim(),
                    ModelCode = ld.Cols[13].Trim(),
                    WarehouseCode = ld.Cols[19].Trim(),
                    OrderLineNumber = Int(ld.Cols[20]),
                    Remark = ld.Cols[21].Trim(),
                    RawColumns = ld.Cols
                });
            }

            orders.Add(new ElectraOrder
            {
                SourceFileName = fileName,
                SupplierCode = first.Cols[0].Trim(),
                BranchCode = first.HeaderBranch,
                OrderNumber = orderNum,
                OrderDate = first.OrderDate,
                DeliveryDate = first.DeliveryDate,
                CustomerName = first.CustName,
                CustomerPhone = first.CustPhone,
                CustomerAddress = first.CustAddr,
                CustomerCity = first.CustCity,
                DeliveryBranchCode = first.DelBranch,
                Lines = lines
            });
        }

        return OneOf<IReadOnlyList<ElectraOrder>>.Success(orders);
    }

    private static bool TryDate(string s, out DateOnly d) =>
        DateOnly.TryParseExact(s.Trim(), "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out d);

    private static decimal Dec(string s) =>
        decimal.TryParse(s.Trim(), NumberStyles.Number, CultureInfo.InvariantCulture, out var v) ? v : 0m;

    private static int Int(string s) =>
        int.TryParse(s.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) ? v : 0;
}
