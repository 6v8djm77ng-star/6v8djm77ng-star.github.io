using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Enums;
using SegmentHub.Domain.Model;
using SegmentHub.Modules.DeliveryNotes.Rules;
using SegmentHub.Tests.Fakes;
using Xunit;

namespace SegmentHub.Tests.DeliveryNotes;

public class DeliveryNoteValidatorTests
{
    private readonly FakeSapGateway _sap = new();
    private readonly DeliveryNoteValidator _sut;

    public DeliveryNoteValidatorTests()
    {
        _sut = new DeliveryNoteValidator(_sap, _ => "2005000");
        _sap.NextDeliveryNote = new DeliveryNoteHandle(1, 2001234, "C10001", true);
    }

    private static DeliveryNoteStatusFile MakeFile(
        string dnRef = "2001234",
        DeliveryNoteAction action = DeliveryNoteAction.Delivered,
        int lineCount = 1,
        string? secondDnRef = null)
    {
        var lines = Enumerable.Range(0, lineCount).Select(i => new DeliveryNoteStatusLine
        {
            SupplierCode = "600060078",
            BranchCode = "001",
            DeliveryNoteRef = DocumentKey.From(i == 1 && secondDnRef != null ? secondDnRef : dnRef),
            OrderRef = DocumentKey.From("10300001"),
            ActionDate = DateOnly.FromDateTime(DateTime.Today),
            Action = action,
            ItemCode = $"ITEM{i:D5}",
            Quantity = 1,
            ReceivedQuantity = action == DeliveryNoteAction.PartialDelivery ? 0.5m : 1,
            StatusCode = "1",
            RawColumns = []
        }).ToList();

        return new DeliveryNoteStatusFile
        {
            SourceFileName = "DN_Status_001.txt",
            SupplierCode = "600060078",
            Lines = lines
        };
    }

    [Fact]
    public async Task Valid_delivered_passes()
    {
        var result = await _sut.ValidateAsync(MakeFile(), CancellationToken.None);
        Assert.Null(result);
    }

    [Fact]
    public async Task Empty_file_rejects()
    {
        var file = MakeFile(lineCount: 0);
        var result = await _sut.ValidateAsync(file, CancellationToken.None);
        Assert.NotNull(result);
        Assert.Equal(RejectionCode.MalformedFile, result.Code);
    }

    [Fact]
    public async Task Non_numeric_dn_ref_rejects()
    {
        var file = MakeFile(dnRef: "ABC-123.");
        var result = await _sut.ValidateAsync(file, CancellationToken.None);
        Assert.NotNull(result);
        Assert.Equal(RejectionCode.LinkedDeliveryNoteNotFound, result.Code);
    }

    [Fact]
    public async Task Mixed_dn_references_rejects()
    {
        var file = MakeFile(lineCount: 2, secondDnRef: "2005678");
        var result = await _sut.ValidateAsync(file, CancellationToken.None);
        Assert.NotNull(result);
        Assert.Equal(RejectionCode.MalformedFile, result.Code);
    }

    [Fact]
    public async Task Unknown_action_rejects()
    {
        var file = MakeFile(action: DeliveryNoteAction.Unknown);
        var result = await _sut.ValidateAsync(file, CancellationToken.None);
        Assert.NotNull(result);
        Assert.Equal(RejectionCode.DeliveryNoteStatusMismatch, result.Code);
    }

    [Fact]
    public async Task Dn_not_found_in_sap_rejects()
    {
        _sap.NextDeliveryNote = null;
        var result = await _sut.ValidateAsync(MakeFile(), CancellationToken.None);
        Assert.NotNull(result);
        Assert.Equal(RejectionCode.LinkedDeliveryNoteNotFound, result.Code);
    }

    [Fact]
    public async Task Return_on_closed_dn_rejects()
    {
        _sap.NextDeliveryNote = new DeliveryNoteHandle(1, 2001234, "C10001", IsOpen: false);
        var file = MakeFile(action: DeliveryNoteAction.Returned);
        var result = await _sut.ValidateAsync(file, CancellationToken.None);
        Assert.NotNull(result);
        Assert.Equal(RejectionCode.DeliveryNoteStatusMismatch, result.Code);
    }

    [Fact]
    public async Task Partial_delivery_on_open_dn_passes()
    {
        var file = MakeFile(action: DeliveryNoteAction.PartialDelivery);
        var result = await _sut.ValidateAsync(file, CancellationToken.None);
        Assert.Null(result);
    }
}
