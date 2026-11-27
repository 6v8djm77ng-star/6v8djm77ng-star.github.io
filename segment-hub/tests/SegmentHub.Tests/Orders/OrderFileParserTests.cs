using SegmentHub.Domain.Enums;
using SegmentHub.Modules.Orders.Parsing;

namespace SegmentHub.Tests.Orders;

public class OrderFileParserTests
{
    private readonly OrderFileParser _parser = new();

    private static string MakeRow(string orderNum = "103500001", string orderDate = "20261127",
        string deliveryDate = "20261201", string itemCode = "EL-1234", int colCount = 38)
    {
        var cols = new string[colCount];
        cols[0] = "600060078";
        cols[1] = "001";
        cols[2] = orderNum;
        cols[3] = orderDate;
        cols[4] = deliveryDate;
        cols[5] = itemCode;
        cols[6] = "מקרר אלקטרה 500 ליטר";
        cols[7] = "1";
        cols[8] = "3500.00";
        cols[9] = "0";
        cols[10] = "3500.00";
        cols[11] = "WH";
        cols[12] = "L";
        cols[13] = "MDL-500";
        cols[14] = "";
        cols[15] = "";
        cols[16] = "";
        cols[17] = "";
        cols[18] = "001";
        cols[19] = "01";
        cols[20] = "1";
        cols[21] = "";
        for (int i = 22; i < colCount; i++) cols[i] = "";
        return string.Join('\t', cols);
    }

    [Fact]
    public void Parse_SingleOrder_ReturnsOrder()
    {
        var text = MakeRow();
        var result = _parser.ParseAll("test.txt", text);

        Assert.True(result.Ok);
        Assert.Single(result.Value!);
        var order = result.Value![0];
        Assert.Equal("103500001", order.OrderNumber);
        Assert.Equal("600060078", order.SupplierCode);
        Assert.Equal("001", order.BranchCode);
        Assert.Single(order.Lines);
        Assert.Equal("EL-1234", order.Lines[0].ItemCode);
        Assert.Equal(3500m, order.Lines[0].LineTotal);
    }

    [Fact]
    public void Parse_MultipleOrdersInOneFile_GroupsByOrderNumber()
    {
        var text = MakeRow("103500001") + "\r\n" + MakeRow("103500001", itemCode: "EL-5678") + "\r\n" + MakeRow("103500002");
        var result = _parser.ParseAll("multi.txt", text);

        Assert.True(result.Ok);
        Assert.Equal(2, result.Value!.Count);
        Assert.Equal(2, result.Value![0].Lines.Count);
        Assert.Single(result.Value![1].Lines);
    }

    [Fact]
    public void Parse_WrongColumnCount_Rejects()
    {
        var text = "col1\tcol2\tcol3";
        var result = _parser.Parse("bad.txt", text);

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
    public void Parse_InvalidDate_Rejects()
    {
        var text = MakeRow(orderDate: "NOTADATE");
        var result = _parser.Parse("bad_date.txt", text);

        Assert.False(result.Ok);
        Assert.Equal(RejectionCode.MalformedFile, result.Rejection!.Code);
        Assert.Contains("תאריך הזמנה", result.Rejection.Message);
    }

    [Fact]
    public void Parse_B2COrder_DetectsHomeDelivery()
    {
        var cols = new string[38];
        cols[0] = "600060078"; cols[1] = "001"; cols[2] = "999600001";
        cols[3] = "20261127"; cols[4] = "20261201"; cols[5] = "EL-9999";
        cols[6] = "תנור"; cols[7] = "1"; cols[8] = "2000"; cols[9] = "0"; cols[10] = "2000";
        cols[11] = ""; cols[12] = ""; cols[13] = "";
        cols[14] = "ישראל ישראלי"; cols[15] = "0501234567"; cols[16] = "הרצל 1"; cols[17] = "תל אביב";
        cols[18] = ""; cols[19] = "01"; cols[20] = "1"; cols[21] = "";
        for (int i = 22; i < 38; i++) cols[i] = "";
        var text = string.Join('\t', cols);

        var result = _parser.Parse("b2c.txt", text);
        Assert.True(result.Ok);
        Assert.True(result.Value!.IsHomeDelivery);
        Assert.Equal("ישראל ישראלי", result.Value!.CustomerName);
    }
}
