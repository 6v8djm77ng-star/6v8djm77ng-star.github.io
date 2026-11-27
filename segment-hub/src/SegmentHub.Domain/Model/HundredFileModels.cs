using System.Text;

namespace SegmentHub.Domain.Model;

/// <summary>One invoice record to be written into the fixed-width "קובץ 100" (ממשק 7, outbound).</summary>
public sealed record InvoiceForHundredFile
{
    public required string InvoiceNumber { get; init; }
    public required DateOnly InvoiceDate { get; init; }
    public required string CustomerCode { get; init; }
    public required string CustomerName { get; init; }
    public required decimal NetAmount { get; init; }
    public required decimal VatAmount { get; init; }
    public required decimal TotalAmount { get; init; }
    public required int SapDocEntry { get; init; }
}

/// <summary>
/// קובץ 100 (ממשק 7) — outbound fixed-width, 100 תווים לשורה.
/// שלושה סוגי שורות: 0=כותרת, 1=פירוט חשבונית, 2=סיכום.
/// </summary>
public sealed record HundredFileDocument
{
    public required string SupplierCode { get; init; }
    public required DateOnly DateFrom { get; init; }
    public required DateOnly DateTo { get; init; }
    public required int SequenceNumber { get; init; }
    public required IReadOnlyList<InvoiceForHundredFile> Invoices { get; init; }

    /// <summary>שם הקובץ לפי המוסכמה: 100_{SupplierCode}_{DateTo:yyyyMMdd}_{Seq}.txt</summary>
    public string FileName =>
        $"100_{SupplierCode}_{DateTo:yyyyMMdd}_{SequenceNumber:D4}.txt";

    /// <summary>מייצר את תוכן הקובץ כ-fixed-width, 100 תווים לשורה.</summary>
    public byte[] Serialize()
    {
        var sb = new StringBuilder();

        // Header (type 0)
        sb.AppendLine(Pad(
            $"0{SupplierCode.PadRight(10)[..10]}" +
            $"{DateFrom:yyyyMMdd}{DateTo:yyyyMMdd}" +
            $"{SequenceNumber.ToString().PadLeft(8, '0')}"));

        // Detail lines (type 1)
        foreach (var inv in Invoices)
        {
            sb.AppendLine(Pad(
                $"1{inv.InvoiceNumber.PadRight(10)[..10]}" +
                $"{inv.InvoiceDate:yyyyMMdd}" +
                $"{inv.CustomerCode.PadRight(10)[..10]}" +
                $"{inv.CustomerName.PadRight(30)[..30]}" +
                $"{Amt(inv.NetAmount, 14)}" +
                $"{Amt(inv.VatAmount, 12)}" +
                $"{Amt(inv.TotalAmount, 14)}"));
        }

        // Footer (type 2)
        var netSum = Invoices.Sum(i => i.NetAmount);
        var vatSum = Invoices.Sum(i => i.VatAmount);
        var totalSum = Invoices.Sum(i => i.TotalAmount);
        sb.AppendLine(Pad(
            $"2{Invoices.Count.ToString().PadLeft(8, '0')}" +
            $"{Amt(netSum, 14)}{Amt(vatSum, 14)}{Amt(totalSum, 14)}"));

        return Encoding.UTF8.GetBytes(sb.ToString());
    }

    private static string Pad(string line) => line.PadRight(100)[..100];

    private static string Amt(decimal amount, int width)
    {
        var cents = (long)Math.Round(amount * 100);
        return cents.ToString().PadLeft(width, '0');
    }
}
