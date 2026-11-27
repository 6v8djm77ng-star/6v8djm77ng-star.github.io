using SegmentHub.Domain.Enums;
using SegmentHub.Modules.SupplyApprovals.Parsing;
using Xunit;

namespace SegmentHub.Tests.SupplyApprovals;

public class EntryFileParserTests
{
    private static string Row(string dn, string order) =>
        string.Join('\t',
            "600060078", "012", "15944771", "20261126", dn, order, "",
            "100.00", "2.00", "0", "0", "0", "1.00", "1.00", "0.00", "200.00", "");

    [Fact]
    public void Parses_a_well_formed_row()
    {
        var result = new EntryFileParser().Parse("Entry_15944771.txt", Row("2003837", "103251144"));
        Assert.True(result.Ok);
        var approval = result.Value!;
        Assert.Single(approval.Lines);
        Assert.Equal("2003837", approval.DeliveryNoteRef.Normalized);
        Assert.Equal(200.00m, approval.Lines[0].LineTotal);
    }

    [Fact]
    public void Dotted_delivery_note_still_parses_and_normalizes()
    {
        var result = new EntryFileParser().Parse("Entry.txt", Row("2003837.", "103251144"));
        Assert.True(result.Ok);
        Assert.Equal("2003837", result.Value!.DeliveryNoteRef.Normalized);
    }

    [Fact]
    public void Wrong_column_count_is_rejected_with_a_code()
    {
        var result = new EntryFileParser().Parse("bad.txt", "600060078\t012\t15944771");
        Assert.False(result.Ok);
        Assert.Equal(RejectionCode.WrongColumnCount, result.Rejection!.Code);
    }

    [Fact]
    public void Empty_file_is_rejected()
    {
        var result = new EntryFileParser().Parse("empty.txt", "");
        Assert.False(result.Ok);
        Assert.Equal(RejectionCode.MalformedFile, result.Rejection!.Code);
    }
}
