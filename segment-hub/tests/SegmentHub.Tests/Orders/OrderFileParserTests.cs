using SegmentHub.Domain.Enums;
using SegmentHub.Modules.Orders.Parsing;
using Xunit;

namespace SegmentHub.Tests.Orders;

public class OrderFileParserTests
{
    private readonly OrderFileParser _parser = new();

    // 38-column Electra order row, mirroring the EasySale importer column map.
    // All values are synthetic test data (never real production records).
    private static string MakeRow(
        string orderNum = "100001", string cardCode = "C50000",
        string docDate = "20261127", string dueDate = "20261201",
        string itemCode = "IT100", string quantity = "1", string unitPrice = "100.00",
        string lineTotal = "100.00", string fatherCard = "2005000",
        string? addrStreet = null)
    {
        var c = new string[38];
        for (int i = 0; i < 38; i++) c[i] = "";
        c[0] = fatherCard;
        c[1] = orderNum;
        c[4] = cardCode;
        c[5] = docDate;
        c[6] = dueDate;
        c[8] = "1500.00";
        c[11] = "";
        c[13] = itemCode;
        c[14] = "מוצר בדיקה";
        c[16] = "1000000000001";
        c[17] = "1";
        c[18] = quantity;
        c[20] = "0";
        c[21] = unitPrice;
        c[23] = lineTotal;
        c[25] = "";
        if (addrStreet != null) { c[29] = addrStreet; c[30] = "1"; }
        return string.Join('\t', c);
    }

    [Fact]
    public void Parse_SingleOrder_MapsHeaderAndLineColumns()
    {
        var result = _parser.ParseAll("test.txt", MakeRow());
        Assert.True(result.Ok);
        Assert.Single(result.Value!);
        var order = result.Value![0];
        Assert.Equal("100001", order.OrderNumber);   // col [1]
        Assert.Equal("2005000", order.FatherCard);    // col [0]
        Assert.Equal("C50000", order.CardCode);       // col [4]
        Assert.Equal(new DateOnly(2026, 11, 27), order.OrderDate);    // col [5]
        Assert.Equal(new DateOnly(2026, 12, 1), order.DeliveryDate);  // col [6]
        Assert.Single(order.Lines);
        var l = order.Lines[0];
        Assert.Equal("IT100", l.ItemCode);            // col [13]
        Assert.Equal("מוצר בדיקה", l.Description);     // col [14]
        Assert.Equal("1000000000001", l.Barcode);     // col [16]
        Assert.Equal(1m, l.Quantity);                 // col [18]
        Assert.Equal(100m, l.UnitPrice);              // col [21]
        Assert.Equal(100m, l.LineTotal);              // col [23]
    }

    [Fact]
    public void Parse_MultipleOrdersInOneFile_GroupsByOrderAndCustomer()
    {
        var text = MakeRow("100001") + "\r\n" + MakeRow("100001", itemCode: "IT200") + "\r\n" + MakeRow("100002");
        var result = _parser.ParseAll("multi.txt", text);
        Assert.True(result.Ok);
        Assert.Equal(2, result.Value!.Count);
        Assert.Equal(2, result.Value![0].Lines.Count);
        Assert.Single(result.Value![1].Lines);
    }

    [Fact]
    public void Parse_WrongColumnCount_Rejects()
    {
        var result = _parser.Parse("bad.txt", "col1\tcol2\tcol3");
        Assert.False(result.Ok);
        Assert.Equal(RejectionCode.WrongColumnCount, result.Rejection!.Code);
    }

    [Fact]
    public void Parse_EmptyFile_Rejects()
    {
        var result = _parser.Parse("empty.txt", "");
        Assert.False(result.Ok);
        Assert.Equal(RejectionCode.MalformedFile, result.Rejection!.Code);
    }

    [Fact]
    public void Parse_InvalidDocDate_Rejects()
    {
        var result = _parser.Parse("bad_date.txt", MakeRow(docDate: "NOTADATE"));
        Assert.False(result.Ok);
        Assert.Equal(RejectionCode.MalformedFile, result.Rejection!.Code);
        Assert.Contains("תאריך מסמך", result.Rejection.Message);
    }

    [Fact]
    public void Parse_BadQuantity_Rejects()
    {
        var result = _parser.Parse("bad_qty.txt", MakeRow(quantity: "NaN"));
        Assert.False(result.Ok);
        Assert.Equal(RejectionCode.MalformedFile, result.Rejection!.Code);
        Assert.Contains("כמות", result.Rejection.Message);
    }

    [Fact]
    public void Parse_B2COrder_DetectsHomeDelivery()
    {
        var result = _parser.Parse("b2c.txt", MakeRow(addrStreet: "הרצל"));
        Assert.True(result.Ok);
        Assert.True(result.Value!.IsHomeDelivery);
        Assert.Contains("הרצל", result.Value!.ClientAddress);
    }

    [Fact]
    public void Parse_B2BOrder_NoHomeDelivery()
    {
        var result = _parser.Parse("b2b.txt", MakeRow());
        Assert.True(result.Ok);
        Assert.False(result.Value!.IsHomeDelivery);
    }
}
