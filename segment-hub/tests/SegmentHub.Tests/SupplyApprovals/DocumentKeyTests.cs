using SegmentHub.Domain.Model;
using Xunit;

namespace SegmentHub.Tests.SupplyApprovals;

/// <summary>
/// These tests pin the root-cause fix: a delivery-note reference must match SAP's integer DocNum
/// even when Segment sends it with a trailing dot, stray spaces, leading zeros or a BOM — the exact
/// shapes that silently broke EasySale.
/// </summary>
public class DocumentKeyTests
{
    [Theory]
    [InlineData("2003837", "2003837")]
    [InlineData("2003837.", "2003837")]      // the trailing dot from the 13.11 incident
    [InlineData(" 2003837 ", "2003837")]     // stray whitespace
    [InlineData("2003837\r\n", "2003837")]   // line ending left in the field
    [InlineData("0139", "139")]              // leading zeros (card 139 vs 0139)
    [InlineData("﻿2003924", "2003924")] // BOM glued to the value
    public void Normalizes_messy_references_to_the_same_key(string raw, string expected)
    {
        var key = DocumentKey.From(raw);
        Assert.True(key.IsNumeric);
        Assert.Equal(expected, key.Normalized);
    }

    [Fact]
    public void Dotted_and_clean_reference_are_equal()
    {
        Assert.Equal(DocumentKey.From("2003837").Normalized, DocumentKey.From("2003837.").Normalized);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("ABC")]
    public void Non_numeric_reference_is_flagged_not_silently_matched(string raw)
    {
        var key = DocumentKey.From(raw);
        Assert.False(key.IsNumeric);
    }

    [Fact]
    public void All_zeros_does_not_collapse_to_empty()
    {
        var key = DocumentKey.From("000");
        Assert.True(key.IsNumeric);
        Assert.Equal("000", key.Normalized);
    }
}
