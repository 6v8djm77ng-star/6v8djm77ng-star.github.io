using System.Globalization;
using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Enums;
using SegmentHub.Domain.Model;

namespace SegmentHub.Modules.DeliveryNotes.Parsing;

/// <summary>
/// Parses a delivery note status file (ממשק 9). Layout observed on server 220:
/// 42 tab-separated columns, UTF-8-BOM, CRLF. Reports B2B delivery status back from Electra branches.
/// </summary>
public sealed class DeliveryNoteFileParser : IRecordParser<DeliveryNoteStatusFile>
{
    public const int ExpectedColumns = 42;
    private static readonly char[] LineSeparators = ['\r', '\n'];

    public OneOf<DeliveryNoteStatusFile> Parse(string fileName, string text)
    {
        var rows = text.Split(LineSeparators, StringSplitOptions.RemoveEmptyEntries);
        if (rows.Length == 0)
            return OneOf<DeliveryNoteStatusFile>.Reject(RejectionCode.MalformedFile, "קובץ ריק");

        var lines = new List<DeliveryNoteStatusLine>(rows.Length);
        foreach (var row in rows)
        {
            var cols = row.Split('\t');
            if (cols.Length != ExpectedColumns)
                return OneOf<DeliveryNoteStatusFile>.Reject(RejectionCode.WrongColumnCount,
                    $"צפויות {ExpectedColumns} עמודות, התקבלו {cols.Length}");

            if (!TryParseLine(cols, out var line, out var reason))
                return OneOf<DeliveryNoteStatusFile>.Reject(reason!.Code, reason.Message);

            lines.Add(line!);
        }

        var supplier = lines[0].SupplierCode;
        return OneOf<DeliveryNoteStatusFile>.Success(new DeliveryNoteStatusFile
        {
            SourceFileName = fileName,
            SupplierCode = supplier,
            Lines = lines
        });
    }

    private static bool TryParseLine(string[] c, out DeliveryNoteStatusLine? line, out RejectionReason? reason)
    {
        line = null; reason = null;

        if (!TryDate(c[4], out var actionDate))
        { reason = Bad($"תאריך לא חוקי '{c[4]}'"); return false; }

        line = new DeliveryNoteStatusLine
        {
            SupplierCode = c[0].Trim(),
            BranchCode = c[1].Trim(),
            DeliveryNoteRef = DocumentKey.From(c[2]),
            OrderRef = DocumentKey.From(c[3]),
            ActionDate = actionDate,
            Action = ParseAction(c[5].Trim()),
            ItemCode = c[6].Trim(),
            Quantity = Dec(c[7]),
            ReceivedQuantity = Dec(c[8]),
            Remark = string.IsNullOrWhiteSpace(c[9]) ? null : c[9].Trim(),
            StatusCode = c[10].Trim(),
            RawColumns = c
        };
        return true;
    }

    private static DeliveryNoteAction ParseAction(string code) => code switch
    {
        "1" => DeliveryNoteAction.Delivered,
        "2" => DeliveryNoteAction.Returned,
        "3" => DeliveryNoteAction.PartialDelivery,
        _ => DeliveryNoteAction.Unknown
    };

    private static RejectionReason Bad(string m) => new(RejectionCode.MalformedFile, m);

    private static bool TryDate(string s, out DateOnly d) =>
        DateOnly.TryParseExact(s.Trim(), "yyyyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out d);

    private static decimal Dec(string s) =>
        decimal.TryParse(s.Trim(), NumberStyles.Number, CultureInfo.InvariantCulture, out var v) ? v : 0m;
}
