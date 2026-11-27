using System.Text;
using SegmentHub.Domain.Model;

namespace SegmentHub.Modules.HundredFile.Generation;

/// <summary>
/// Builds the fixed-width "קובץ 100" (ממשק 7) from SAP invoice data.
/// Format: 100 characters per line, CRLF line endings, Windows-1255 encoding for Hebrew customer names.
/// Line types: 0=header, 1=detail (one per invoice), 2=footer with totals.
/// Amounts are written as integers in agora (multiply by 100, no decimal point).
/// </summary>
public static class HundredFileGenerator
{
    private const int LineWidth = 100;
    private static Encoding? _win1255;
    private static Encoding Win1255 => _win1255 ??= Encoding.GetEncoding(1255);

    public static byte[] Generate(
        string supplierCode,
        DateOnly dateFrom,
        DateOnly dateTo,
        int sequenceNumber,
        IReadOnlyList<InvoiceForHundredFile> invoices)
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

        var sb = new StringBuilder();

        // Type 0: Header
        sb.Append('0');
        sb.Append(PadRight(supplierCode, 9));
        sb.Append(dateFrom.ToString("yyyyMMdd"));
        sb.Append(dateTo.ToString("yyyyMMdd"));
        sb.Append(sequenceNumber.ToString().PadLeft(8, '0'));
        PadToWidth(sb);
        sb.Append("\r\n");

        // Type 1: Detail lines
        foreach (var inv in invoices)
        {
            sb.Append('1');
            sb.Append(PadRight(inv.InvoiceNumber, 9));
            sb.Append(inv.InvoiceDate.ToString("yyyyMMdd"));
            sb.Append(PadRight(inv.CustomerCode, 10));
            sb.Append(PadRight(inv.CustomerName, 30));
            sb.Append(FormatAmount(inv.NetAmount, 14));
            sb.Append(FormatAmount(inv.VatAmount, 12));
            sb.Append(FormatAmount(inv.TotalAmount, 14));
            PadToWidth(sb);
            sb.Append("\r\n");
        }

        // Type 2: Footer
        var totalNet = invoices.Sum(i => i.NetAmount);
        var totalVat = invoices.Sum(i => i.VatAmount);
        var totalAmount = invoices.Sum(i => i.TotalAmount);

        sb.Append('2');
        sb.Append(invoices.Count.ToString().PadLeft(8, '0'));
        sb.Append(FormatAmount(totalNet, 14));
        sb.Append(FormatAmount(totalVat, 12));
        sb.Append(FormatAmount(totalAmount, 14));
        PadToWidth(sb);
        sb.Append("\r\n");

        return Win1255.GetBytes(sb.ToString());
    }

    private static string PadRight(string value, int width)
    {
        if (value.Length >= width)
            return value[..width];
        return value.PadRight(width);
    }

    private static string FormatAmount(decimal amount, int width)
    {
        var agora = (long)Math.Round(amount * 100);
        return agora.ToString().PadLeft(width, '0');
    }

    private static void PadToWidth(StringBuilder sb)
    {
        // Find position within the current line (after last \r\n)
        var lineStart = sb.Length;
        for (int i = sb.Length - 1; i >= 0; i--)
        {
            if (sb[i] == '\n') { lineStart = i + 1; break; }
            if (i == 0) lineStart = 0;
        }
        var currentLen = sb.Length - lineStart;
        if (currentLen < LineWidth)
            sb.Append(' ', LineWidth - currentLen);
    }
}
