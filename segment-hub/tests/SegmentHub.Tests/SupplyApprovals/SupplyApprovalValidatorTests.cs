using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Enums;
using SegmentHub.Domain.Model;
using SegmentHub.Modules.SupplyApprovals.Rules;
using SegmentHub.Tests.Fakes;
using Xunit;

namespace SegmentHub.Tests.SupplyApprovals;

public class SupplyApprovalValidatorTests
{
    private readonly FakeSapGateway _sap = new();
    private readonly SupplyApprovalValidator _sut;

    public SupplyApprovalValidatorTests()
    {
        _sut = new SupplyApprovalValidator(_sap);
        _sap.NextDeliveryNote = new DeliveryNoteHandle(1, 2001234, "C10001", true);
    }

    private static SupplyApproval MakeApproval(
        string dnRef = "2001234",
        int lineCount = 1,
        string? secondDnRef = null)
    {
        var lines = Enumerable.Range(0, lineCount).Select(i => new SupplyApprovalLine
        {
            SupplierCode = "600060078",
            CardCode = "C10001",
            ApprovalNumber = "10000001",
            ApprovalDate = DateOnly.FromDateTime(DateTime.Today),
            DeliveryNoteRef = DocumentKey.From(i == 1 && secondDnRef != null ? secondDnRef : dnRef),
            NumAtCard = "10300001",
            ItemCode = "ITEM1",
            Barcode = "729",
            LineNumber = i,
            Quantity = 1,
            UnitPrice = 100m,
            RawColumns = []
        }).ToList();

        return new SupplyApproval
        {
            SourceFileName = "Entry_001.txt",
            SupplierCode = "600060078",
            Lines = lines
        };
    }

    [Fact]
    public async Task Valid_approval_passes()
    {
        var result = await _sut.ValidateAsync(MakeApproval(), CancellationToken.None);
        Assert.Null(result);
    }

    [Fact]
    public async Task Empty_lines_rejects()
    {
        var approval = MakeApproval(lineCount: 0);
        var result = await _sut.ValidateAsync(approval, CancellationToken.None);
        Assert.NotNull(result);
        Assert.Equal(RejectionCode.MalformedFile, result.Code);
    }

    [Fact]
    public async Task Non_numeric_dn_ref_rejects()
    {
        var approval = MakeApproval(dnRef: "ABC.123.");
        var result = await _sut.ValidateAsync(approval, CancellationToken.None);
        Assert.NotNull(result);
        Assert.Equal(RejectionCode.LinkedDeliveryNoteNotFound, result.Code);
    }

    [Fact]
    public async Task Mixed_dn_references_rejects()
    {
        var approval = MakeApproval(lineCount: 2, secondDnRef: "2005678");
        var result = await _sut.ValidateAsync(approval, CancellationToken.None);
        Assert.NotNull(result);
        Assert.Equal(RejectionCode.MalformedFile, result.Code);
    }

    [Fact]
    public async Task Dn_not_found_in_sap_rejects()
    {
        _sap.NextDeliveryNote = null;
        var result = await _sut.ValidateAsync(MakeApproval(), CancellationToken.None);
        Assert.NotNull(result);
        Assert.Equal(RejectionCode.LinkedDeliveryNoteNotFound, result.Code);
    }

    [Fact]
    public async Task Closed_dn_rejects()
    {
        _sap.NextDeliveryNote = new DeliveryNoteHandle(1, 2001234, "C10001", IsOpen: false);
        var result = await _sut.ValidateAsync(MakeApproval(), CancellationToken.None);
        Assert.NotNull(result);
        Assert.Equal(RejectionCode.DeliveryNoteAlreadyInvoiced, result.Code);
    }
}
