using SegmentHub.Domain.Enums;
using SegmentHub.Modules.DeliveryNotes.Parsing;
using Xunit;

namespace SegmentHub.Tests.DeliveryNotes;

public class DeliveryNoteFileParserTests
{
    private readonly DeliveryNoteFileParser _parser = new();

    private static string MakeLine(string? actionCode = "1", int cols = 42)
    {
        var parts = new string[cols];
        parts[0] = "600060078";      // SupplierCode
        parts[1] = "101";            // BranchCode
        parts[2] = "2003837";        // DeliveryNoteNumber
        parts[3] = "1030001";        // OrderNumber
        parts[4] = "20261127";       // ActionDate
        parts[5] = actionCode ?? "1"; // ActionCode
        parts[6] = "ITEM001";        // ItemCode
        parts[7] = "5.00";           // Quantity
        parts[8] = "5.00";           // ReceivedQuantity
        parts[9] = "";               // Remark
        parts[10] = "OK";            // StatusCode
        for (int i = 11; i < cols; i++) parts[i] = "";
        return string.Join('\t', parts);
    }

    [Fact]
    public void Parse_ValidFile_ReturnsSuccess()
    {
        var text = MakeLine();
        var result = _parser.Parse("test.txt", text);

        Assert.True(result.Ok);
        Assert.Single(result.Value!.Lines);
        Assert.Equal("600060078", result.Value!.SupplierCode);
        Assert.Equal(DeliveryNoteAction.Delivered, result.Value!.Lines[0].Action);
        Assert.Equal("2003837", result.Value!.Lines[0].DeliveryNoteRef.Normalized);
    }

    [Fact]
    public void Parse_EmptyFile_RejectsAsMalformed()
    {
        var result = _parser.Parse("empty.txt", "");
        Assert.False(result.Ok);
        Assert.Equal(RejectionCode.MalformedFile, result.Rejection!.Code);
    }

    [Fact]
    public void Parse_WrongColumnCount_Rejects()
    {
        var result = _parser.Parse("bad.txt", "a\tb\tc");
        Assert.False(result.Ok);
        Assert.Equal(RejectionCode.WrongColumnCount, result.Rejection!.Code);
    }

    [Theory]
    [InlineData("1", DeliveryNoteAction.Delivered)]
    [InlineData("2", DeliveryNoteAction.Returned)]
    [InlineData("3", DeliveryNoteAction.PartialDelivery)]
    [InlineData("9", DeliveryNoteAction.Unknown)]
    public void Parse_ActionCodes_MapCorrectly(string code, DeliveryNoteAction expected)
    {
        var text = MakeLine(actionCode: code);
        var result = _parser.Parse("test.txt", text);
        Assert.True(result.Ok);
        Assert.Equal(expected, result.Value!.Lines[0].Action);
    }

    [Fact]
    public void Parse_MultipleLines_AllParsed()
    {
        var text = MakeLine() + "\r\n" + MakeLine(actionCode: "2");
        var result = _parser.Parse("multi.txt", text);
        Assert.True(result.Ok);
        Assert.Equal(2, result.Value!.Lines.Count);
    }

    [Fact]
    public void Parse_BadDate_Rejects()
    {
        var parts = new string[42];
        for (int i = 0; i < 42; i++) parts[i] = "";
        parts[0] = "600060078";
        parts[1] = "101";
        parts[2] = "2003837";
        parts[3] = "1030001";
        parts[4] = "BADDATE";
        parts[5] = "1";
        parts[6] = "ITEM001";
        parts[7] = "5";
        parts[8] = "5";
        parts[10] = "OK";
        var text = string.Join('\t', parts);

        var result = _parser.Parse("bad.txt", text);
        Assert.False(result.Ok);
        Assert.Equal(RejectionCode.MalformedFile, result.Rejection!.Code);
    }
}
