using System.Text;
using SegmentHub.Domain.Model;
using SegmentHub.Modules.HundredFile.Generation;
using Xunit;

namespace SegmentHub.Tests.HundredFile;

public class HundredFileGeneratorTests
{
    public HundredFileGeneratorTests()
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
    }

    private static InvoiceForHundredFile MakeInvoice(
        string number = "INV001",
        decimal net = 1000m,
        decimal vat = 170m,
        decimal total = 1170m)
    {
        return new InvoiceForHundredFile
        {
            InvoiceNumber = number,
            InvoiceDate = new DateOnly(2026, 11, 27),
            CustomerCode = "C001",
            CustomerName = "לקוח בדיקה",
            NetAmount = net,
            VatAmount = vat,
            TotalAmount = total,
            SapDocEntry = 12345
        };
    }

    [Fact]
    public void Generate_SingleInvoice_ProducesThreeLines()
    {
        var invoices = new[] { MakeInvoice() };
        var bytes = HundredFileGenerator.Generate("600060078", new DateOnly(2026, 11, 26), new DateOnly(2026, 11, 27), 1, invoices);

        var text = Encoding.GetEncoding(1255).GetString(bytes);
        var lines = text.Split("\r\n", StringSplitOptions.RemoveEmptyEntries);

        Assert.Equal(3, lines.Length);
        Assert.Equal('0', lines[0][0]);
        Assert.Equal('1', lines[1][0]);
        Assert.Equal('2', lines[2][0]);
    }

    [Fact]
    public void Generate_AllLinesAre100Chars()
    {
        var invoices = new[] { MakeInvoice(), MakeInvoice("INV002") };
        var bytes = HundredFileGenerator.Generate("600060078", new DateOnly(2026, 11, 26), new DateOnly(2026, 11, 27), 1, invoices);

        var text = Encoding.GetEncoding(1255).GetString(bytes);
        var lines = text.Split("\r\n", StringSplitOptions.RemoveEmptyEntries);

        foreach (var line in lines)
            Assert.Equal(100, line.Length);
    }

    [Fact]
    public void Generate_HeaderContainsSupplierAndDates()
    {
        var bytes = HundredFileGenerator.Generate("600060078", new DateOnly(2026, 11, 26), new DateOnly(2026, 11, 27), 42, new[] { MakeInvoice() });
        var text = Encoding.GetEncoding(1255).GetString(bytes);
        var header = text.Split("\r\n")[0];

        Assert.StartsWith("0", header);
        Assert.Contains("600060078", header);
        Assert.Contains("20261126", header);
        Assert.Contains("20261127", header);
        Assert.Contains("00000042", header);
    }

    [Fact]
    public void Generate_FooterContainsTotals()
    {
        var invoices = new[] { MakeInvoice(net: 1000m, vat: 170m, total: 1170m) };
        var bytes = HundredFileGenerator.Generate("600060078", new DateOnly(2026, 11, 26), new DateOnly(2026, 11, 27), 1, invoices);
        var text = Encoding.GetEncoding(1255).GetString(bytes);
        var lines = text.Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
        var footer = lines[^1];

        Assert.StartsWith("2", footer);
        Assert.Contains("00000001", footer); // record count
    }

    [Fact]
    public void Generate_AmountsInAgora()
    {
        var invoices = new[] { MakeInvoice(net: 100.50m, vat: 17.09m, total: 117.59m) };
        var bytes = HundredFileGenerator.Generate("600060078", new DateOnly(2026, 11, 26), new DateOnly(2026, 11, 27), 1, invoices);
        var text = Encoding.GetEncoding(1255).GetString(bytes);
        var detail = text.Split("\r\n")[1];

        // 100.50 * 100 = 10050
        Assert.Contains("00000000010050", detail);
        // 17.09 * 100 = 1709
        Assert.Contains("000000001709", detail);
    }

    [Fact]
    public void Generate_EmptyInvoices_ProducesHeaderAndFooterOnly()
    {
        var bytes = HundredFileGenerator.Generate("600060078", new DateOnly(2026, 11, 26), new DateOnly(2026, 11, 27), 1, []);
        var text = Encoding.GetEncoding(1255).GetString(bytes);
        var lines = text.Split("\r\n", StringSplitOptions.RemoveEmptyEntries);

        Assert.Equal(2, lines.Length);
        Assert.Equal('0', lines[0][0]);
        Assert.Equal('2', lines[1][0]);
    }

    [Fact]
    public void Generate_HebrewCustomerName_EncodedInWindows1255()
    {
        var invoices = new[] { MakeInvoice() };
        var bytes = HundredFileGenerator.Generate("600060078", new DateOnly(2026, 11, 26), new DateOnly(2026, 11, 27), 1, invoices);

        var text = Encoding.GetEncoding(1255).GetString(bytes);
        Assert.Contains("לקוח בדיקה", text);
    }
}
