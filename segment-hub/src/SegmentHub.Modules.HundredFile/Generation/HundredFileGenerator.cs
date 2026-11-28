using System.Globalization;
using System.Text;
using SegmentHub.Domain.Model;

namespace SegmentHub.Modules.HundredFile.Generation;

/// <summary>
/// Builds a "קובץ 100" (ממשק 7) exactly as the EasySale exporter does (ESG_SegmentFiles_API,
/// HundredFileRow / HundredFileField): fixed-width 100-char records, each field left-padded with '0'
/// to its width, records joined by CRLF, Windows-1255.
/// Order (HundredFileOrderEnum.OrderByDeliveryNotes): Invoice record, then for each base delivery note
/// its DeliveryNote record followed by that note's Line records.
/// </summary>
public static class HundredFileGenerator
{
    public const int RecordWidth = 100;
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    private sealed record Field(string Name, int Width, string? Default = null);

    private static readonly Field[] InvoiceLayout =
    [
        new("RecordType", 1, "0"), new("CardCode", 5), new("SupplierCode", 10), new("InvoiceDate", 6),
        new("InvoiceNum", 10), new("GrossDocTotal", 12), new("DiscountValue", 12), new("PromotionDiscount", 12),
        new("RoundDocTotal", 4), new("FILLER73_80", 8), new("VatSum", 12), new("Currency", 3), new("FILLER96_100", 5)
    ];

    private static readonly Field[] DeliveryNoteLayout =
    [
        new("RecordType", 1, "1"), new("CardCode", 10), new("DocNum", 10), new("DocType", 1), new("DocDate", 6),
        new("SupplyApprovalNum", 10), new("GrossDocTotal", 9), new("FILLER48_71", 24), new("Reference2", 15),
        new("NumAtCardFromPurchaseOrder", 11), new("FILLER98_100", 3)
    ];

    private static readonly Field[] LineLayout =
    [
        new("RecordType", 1, "2"), new("SubCatalogNum", 13), new("ItemCode", 13), new("UnitsOrPackages", 1),
        new("UnitsQuantity", 7), new("QtyPerPackage", 3), new("PackagesQuantity", 3), new("UnitPrice", 11),
        new("DiscountSum", 9), new("FILLER62_79", 18), new("OrderLineNum", 5), new("DeliveryNoteLineNum", 5),
        new("PurchaseOrderNum", 11)
    ];

    public static string FileNameFor(HundredFileInvoice invoice) => $"100_{invoice.InvoiceNumber}.txt";

    public static byte[] Generate(HundredFileInvoice invoice)
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        return Encoding.GetEncoding(1255).GetBytes(Render(invoice));
    }

    public static string Render(HundredFileInvoice invoice)
    {
        if (invoice.DeliveryNotes.Count == 0)
            throw new InvalidOperationException(
                $"קובץ 100: לחשבונית {invoice.InvoiceNumber} אין תעודת משלוח בסיס — לא ניתן להפיק קובץ.");

        var sb = new StringBuilder();
        sb.Append(Record(InvoiceLayout, new()
        {
            ["CardCode"] = invoice.CardCode,
            ["SupplierCode"] = invoice.SupplierCode,
            ["InvoiceDate"] = Date(invoice.InvoiceDate),
            ["InvoiceNum"] = invoice.InvoiceNumber,
            ["GrossDocTotal"] = Money(invoice.GrossDocTotal, "0.00", "GrossDocTotal"),
            // EasySale sets the discount field conditionally; a zero discount is left as the zero default.
            ["DiscountValue"] = invoice.DiscountValue == 0 ? null : Money(invoice.DiscountValue, "0.00", "DiscountValue"),
            ["VatSum"] = Money(invoice.VatSum, ".00", "VatSum"),
            ["Currency"] = invoice.Currency
        })).Append("\r\n");

        foreach (var dn in invoice.DeliveryNotes)
        {
            sb.Append(Record(DeliveryNoteLayout, new()
            {
                ["CardCode"] = dn.CardCode,
                ["DocNum"] = dn.DocNum,
                ["DocType"] = "1", // Segment invoice type, per EasySale
                ["DocDate"] = Date(dn.DocDate),
                ["SupplyApprovalNum"] = dn.SupplyApprovalNum,
                ["NumAtCardFromPurchaseOrder"] = dn.NumAtCardFromPurchaseOrder
            })).Append("\r\n");

            foreach (var line in dn.Lines)
            {
                sb.Append(Record(LineLayout, new()
                {
                    ["SubCatalogNum"] = line.SubCatalogNum,
                    ["ItemCode"] = line.ItemCode,
                    ["UnitsOrPackages"] = "0",
                    ["UnitsQuantity"] = Money(line.Quantity, ".00", "UnitsQuantity"),
                    ["UnitPrice"] = Money(line.UnitPrice, "000000.0000", "UnitPrice"),
                    ["DiscountSum"] = line.DiscountSum,
                    ["OrderLineNum"] = line.OrderLineNum,
                    ["DeliveryNoteLineNum"] = line.DeliveryNoteLineNum,
                    ["PurchaseOrderNum"] = line.PurchaseOrderNum
                })).Append("\r\n");
            }
        }

        return sb.ToString();
    }

    private static string Record(Field[] layout, Dictionary<string, string?> values)
    {
        var sb = new StringBuilder(RecordWidth);
        foreach (var f in layout)
        {
            var v = values.TryGetValue(f.Name, out var given) && given is not null ? given : f.Default;
            sb.Append(Pad(f, v));
        }
        return sb.Length == RecordWidth
            ? sb.ToString()
            : throw new InvalidOperationException($"קובץ 100: רשומה באורך {sb.Length} במקום {RecordWidth}.");
    }

    // EasySale: content = value == null ? "".PadLeft(Length,'0') : value.PadLeft(Length,'0').
    // A value wider than its field would shift every later column, so it is a fault, not a silent cut.
    private static string Pad(Field f, string? value)
    {
        value = value?.Trim() ?? "";
        if (value.Length > f.Width)
            throw new InvalidOperationException(
                $"קובץ 100: הערך '{value}' בשדה {f.Name} חורג מרוחב {f.Width}.");
        return value.PadLeft(f.Width, '0');
    }

    private static string Date(DateOnly d) => d.ToString("yyMMdd", Inv);

    // A negative value would put '-' mid-field. Credit memos need the EasySale credit-memo variant,
    // which is not implemented, so a negative amount is surfaced as a fault.
    private static string Money(decimal amount, string format, string field)
    {
        if (amount < 0)
            throw new InvalidOperationException(
                $"קובץ 100: סכום שלילי ({amount}) בשדה {field} אינו נתמך — זיכוי דורש טיפול נפרד.");
        return amount.ToString(format, Inv);
    }
}
