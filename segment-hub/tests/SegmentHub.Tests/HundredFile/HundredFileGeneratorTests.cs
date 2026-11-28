using System.Text;
using SegmentHub.Domain.Model;
using SegmentHub.Modules.HundredFile.Generation;
using Xunit;

namespace SegmentHub.Tests.HundredFile;

/// <summary>
/// Pins the קובץ 100 layout reverse-engineered from the EasySale exporter: three record types,
/// exact field offsets/widths, '0' left-padding, yyMMdd dates, "0.00"/".00"/"000000.0000" amounts.
/// All data is synthetic.
/// </summary>
public class HundredFileGeneratorTests
{
    public HundredFileGeneratorTests() => Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

    private static HundredFileLine Line(string item = "IT100", decimal qty = 2m, decimal price = 153.85m) => new()
    {
        SubCatalogNum = "SUB1",
        ItemCode = item,
        Quantity = qty,
        UnitPrice = price,
        DeliveryNoteLineNum = "1"
    };

    private static HundredFileInvoice Invoice(params HundredFileDeliveryNote[] notes) => new()
    {
        SapDocEntry = 1,
        InvoiceNumber = "123456",
        SupplierCode = "600060078",
        InvoiceDate = new DateOnly(2026, 11, 27),
        GrossDocTotal = 1000m,
        DiscountValue = 0m,
        VatSum = 180m,
        Currency = "ILS",
        DeliveryNotes = notes.Length > 0 ? notes : [Note()]
    };

    private static HundredFileDeliveryNote Note(string docNum = "2003837", params HundredFileLine[] lines) => new()
    {
        CardCode = "C10001",
        DocNum = docNum,
        DocDate = new DateOnly(2026, 11, 26),
        SupplyApprovalNum = "15944771",
        NumAtCardFromPurchaseOrder = "100001",
        Lines = lines.Length > 0 ? lines : [Line()]
    };

    private static string[] Records(string text) => text.Split("\r\n", StringSplitOptions.RemoveEmptyEntries);

    [Fact]
    public void Every_record_is_exactly_100_chars_and_crlf_terminated()
    {
        var text = HundredFileGenerator.Render(Invoice(Note("1", Line(), Line("IT200")), Note("2")));
        Assert.EndsWith("\r\n", text);
        Assert.All(Records(text), r => Assert.Equal(100, r.Length));
    }

    [Fact]
    public void Records_are_ordered_invoice_then_each_note_followed_by_its_lines()
    {
        var text = HundredFileGenerator.Render(Invoice(Note("1", Line(), Line("IT200")), Note("2")));
        var types = string.Concat(Records(text).Select(r => r[0]));
        Assert.Equal("01221" + "2", types);
    }

    [Fact]
    public void Invoice_record_fields_sit_at_exact_offsets()
    {
        var r = Records(HundredFileGenerator.Render(Invoice()))[0];
        Assert.Equal("0", r[..1]);
        Assert.Equal("00000", r[1..6]);              // CardCode (not set) → zeros
        Assert.Equal("0600060078", r[6..16]);        // SupplierCode, '0' left-padded
        Assert.Equal("261127", r[16..22]);           // yyMMdd
        Assert.Equal("0000123456", r[22..32]);       // InvoiceNum
        Assert.Equal("000001000.00", r[32..44]);     // GrossDocTotal "0.00"
        Assert.Equal("000000000000", r[44..56]);     // zero discount left at default
        Assert.Equal("000000180.00", r[80..92]);     // VatSum ".00"
        Assert.Equal("ILS", r[92..95]);
        Assert.Equal("00000", r[95..100]);
    }

    [Fact]
    public void Delivery_note_record_fields_sit_at_exact_offsets()
    {
        var r = Records(HundredFileGenerator.Render(Invoice()))[1];
        Assert.Equal("1", r[..1]);
        Assert.Equal("0000C10001", r[1..11]);        // CardCode
        Assert.Equal("0002003837", r[11..21]);       // DocNum
        Assert.Equal("1", r[21..22]);                // DocType = Segment
        Assert.Equal("261126", r[22..28]);           // DocDate yyMMdd
        Assert.Equal("0015944771", r[28..38]);       // SupplyApprovalNum
        Assert.Equal("000000000", r[38..47]);        // GrossDocTotal (credit-memo only) → zeros
        Assert.Equal("00000100001", r[86..97]);      // NumAtCardFromPurchaseOrder
    }

    [Fact]
    public void Line_record_fields_sit_at_exact_offsets()
    {
        var r = Records(HundredFileGenerator.Render(Invoice()))[2];
        Assert.Equal("2", r[..1]);
        Assert.Equal("000000000SUB1", r[1..14]);     // SubCatalogNum
        Assert.Equal("00000000IT100", r[14..27]);    // ItemCode
        Assert.Equal("0", r[27..28]);                // UnitsOrPackages
        Assert.Equal("0002.00", r[28..35]);          // UnitsQuantity ".00"
        Assert.Equal("000153.8500", r[41..52]);      // UnitPrice "000000.0000"
        Assert.Equal("00001", r[84..89]);            // DeliveryNoteLineNum
    }

    [Fact]
    public void Negative_amount_is_a_fault_not_a_corrupt_line()
    {
        var ex = Assert.Throws<InvalidOperationException>(() =>
            HundredFileGenerator.Render(Invoice(Note("1", Line(price: -5m)))));
        Assert.Contains("שלילי", ex.Message);
    }

    [Fact]
    public void Value_wider_than_its_field_is_a_fault_not_a_silent_cut()
    {
        var ex = Assert.Throws<InvalidOperationException>(() =>
            HundredFileGenerator.Render(Invoice(Note("1", Line(item: "ITEMCODE-TOO-LONG")))));
        Assert.Contains("ItemCode", ex.Message);
    }

    [Fact]
    public void Invoice_without_a_base_delivery_note_is_refused()
    {
        var inv = Invoice() with { DeliveryNotes = [] };
        Assert.Throws<InvalidOperationException>(() => HundredFileGenerator.Render(inv));
    }

    [Fact]
    public void Generate_encodes_windows_1255_one_byte_per_char()
    {
        var bytes = HundredFileGenerator.Generate(Invoice());
        Assert.Equal(3 * 102, bytes.Length); // 3 records × (100 + CRLF)
    }

    [Fact]
    public void File_name_is_per_invoice()
    {
        Assert.Equal("100_123456.txt", HundredFileGenerator.FileNameFor(Invoice()));
    }
}
