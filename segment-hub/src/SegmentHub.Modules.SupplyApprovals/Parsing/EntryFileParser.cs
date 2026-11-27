using System.Globalization;
using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Enums;
using SegmentHub.Domain.Model;

namespace SegmentHub.Modules.SupplyApprovals.Parsing;

/// <summary>
/// Parses an Entry_* supply-approval file (ממשק 11). Layout observed on server 220 (2026-11-27):
/// 17 tab-separated columns, UTF-8, CRLF. The column map lives here only; the engine never knows it.
/// Expected bad input (wrong column count, bad numbers) returns a typed rejection — never an exception.
/// </summary>
public sealed class EntryFileParser : IRecordParser<SupplyApproval>
{
    public const int ExpectedColumns = 17;
    private static readonly char[] LineSeparators = ['\r', '\n'];

    public OneOf<SupplyApproval> Parse(string fileName, string text)
    {
        var rows = text.Split(LineSeparators, StringSplitOptions.RemoveEmptyEntries);
        if (rows.Length == 0)
            return OneOf<SupplyApproval>.Reject(RejectionCode.MalformedFile, "קובץ ריק");

        var lines = new List<SupplyApprovalLine>(rows.Length);
        foreach (var row in rows)
        {
            var cols = row.Split('\t');
            if (cols.Length != ExpectedColumns)
                return OneOf<SupplyApproval>.Reject(RejectionCode.WrongColumnCount,
                    $"צפויות {ExpectedColumns} עמודות, התקבלו {cols.Length}");

            if (!TryParseLine(cols, out var line, out var reason))
                return OneOf<SupplyApproval>.Reject(reason!.Code, reason.Message);

            lines.Add(line!);
        }

        var supplier = lines[0].SupplierCode;
        return OneOf<SupplyApproval>.Success(new SupplyApproval
        {
            SourceFileName = fileName,
            SupplierCode = supplier,
            Lines = lines
        });
    }

    private static bool TryParseLine(string[] c, out SupplyApprovalLine? line, out RejectionReason? reason)
    {
        line = null; reason = null;

        if (!TryDate(c[3], out var approvalDate))
        { reason = Bad($"תאריך לא חוקי '{c[3]}'"); return false; }

        line = new SupplyApprovalLine
        {
            SupplierCode = c[0].Trim(),
            BranchCode = c[1].Trim(),
            ApprovalNumber = c[2].Trim(),
            ApprovalDate = approvalDate,
            DeliveryNoteRef = DocumentKey.From(c[4]),
            ElectraOrderRef = DocumentKey.From(c[5]),
            UnitPrice = Dec(c[7]),
            Quantity = Dec(c[8]),
            ProductType = Int(c[11]),
            LineTotal = Dec(c[15]),
            RawColumns = c
        };
        return true;
    }

    private static RejectionReason Bad(string m) => new(RejectionCode.MalformedFile, m);

    private static bool TryDate(string s, out DateOnly d) =>
        DateOnly.TryParseExact(s.Trim(), "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out d);

    private static decimal Dec(string s) =>
        decimal.TryParse(s.Trim(), NumberStyles.Number, CultureInfo.InvariantCulture, out var v) ? v : 0m;

    private static int Int(string s) =>
        int.TryParse(s.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) ? v : 0;
}
