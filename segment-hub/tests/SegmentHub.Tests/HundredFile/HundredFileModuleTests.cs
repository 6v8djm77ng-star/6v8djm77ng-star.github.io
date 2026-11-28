using Microsoft.Extensions.Logging.Abstractions;
using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Enums;
using SegmentHub.Domain.Model;
using SegmentHub.Modules.HundredFile;
using SegmentHub.Tests.Fakes;
using Xunit;

namespace SegmentHub.Tests.HundredFile;

public class HundredFileModuleTests
{
    private sealed class FakePublisher : IFilePublisher
    {
        public List<string> Published { get; } = [];
        public List<string> Shadow { get; } = [];
        public Task PublishAsync(string m, string f, byte[] c, CancellationToken ct) { Published.Add(f); return Task.CompletedTask; }
        public Task WriteShadowCopyAsync(string m, string f, byte[] c, CancellationToken ct) { Shadow.Add(f); return Task.CompletedTask; }
    }

    private readonly FakeSapGateway _sap = new();
    private readonly FakePublisher _pub = new();
    private HundredFileModule Sut() => new(_sap, _pub, NullLogger<HundredFileModule>.Instance);

    private static HundredFileInvoice Inv(int entry, decimal price = 100m) => new()
    {
        SapDocEntry = entry,
        InvoiceNumber = entry.ToString(),
        SupplierCode = "600060078",
        InvoiceDate = new DateOnly(2026, 11, 27),
        GrossDocTotal = 100m,
        DiscountValue = 0m,
        VatSum = 18m,
        Currency = "ILS",
        DeliveryNotes =
        [
            new HundredFileDeliveryNote
            {
                CardCode = "C1", DocNum = "2001", DocDate = new DateOnly(2026, 11, 26),
                Lines = [new HundredFileLine { ItemCode = "IT1", Quantity = 1m, UnitPrice = price }]
            }
        ]
    };

    [Fact]
    public async Task Shadow_writes_comparison_copy_and_never_marks_invoices()
    {
        _sap.PendingInvoices = [Inv(11), Inv(12)];
        var result = await Sut().GenerateOutboundAsync(shadowMode: true, CancellationToken.None);

        Assert.Equal(ProcessingStatus.Succeeded, result.Status);
        Assert.Equal(new[] { "100_11.txt", "100_12.txt" }, _pub.Shadow);
        Assert.Empty(_pub.Published);
        Assert.Empty(_sap.MarkedAsReported);
        Assert.True(_sap.LastIncludeReported); // shadow compares against what EasySale already sent
    }

    [Fact]
    public async Task Live_publishes_then_marks_each_invoice()
    {
        _sap.PendingInvoices = [Inv(21)];
        var result = await Sut().GenerateOutboundAsync(shadowMode: false, CancellationToken.None);

        Assert.Equal(ProcessingStatus.Succeeded, result.Status);
        Assert.Equal(new[] { "100_21.txt" }, _pub.Published);
        Assert.Equal(new[] { 21 }, _sap.MarkedAsReported);
        Assert.False(_sap.LastIncludeReported);
    }

    [Fact]
    public async Task Bad_invoice_is_skipped_and_reported_without_blocking_the_rest()
    {
        _sap.PendingInvoices = [Inv(31, price: -1m), Inv(32)];
        var result = await Sut().GenerateOutboundAsync(shadowMode: false, CancellationToken.None);

        Assert.Equal(ProcessingStatus.Faulted, result.Status);
        Assert.Contains("31", result.FaultDetail);
        Assert.Equal(new[] { "100_32.txt" }, _pub.Published);
        Assert.Equal(new[] { 32 }, _sap.MarkedAsReported); // the bad one is NOT marked, so it is retried
    }
}
