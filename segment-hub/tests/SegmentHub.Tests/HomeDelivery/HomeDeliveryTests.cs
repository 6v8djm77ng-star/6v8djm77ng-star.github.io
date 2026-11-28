using Microsoft.Extensions.Logging.Abstractions;
using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Enums;
using SegmentHub.Domain.Model;
using SegmentHub.Modules.HomeDelivery;
using SegmentHub.Tests.Fakes;
using Xunit;

namespace SegmentHub.Tests.HomeDelivery;

// Synthetic data only.
public class HomeDeliveryEligibilityTests
{
    private static readonly DateOnly DnDate = new(2026, 11, 20);

    private static HomeDeliveryCandidate C(bool signed = true, int open = 2, bool direct = false, string? comments = null) => new()
    {
        DnDocEntry = 1, DnDocNum = 5001, DnDate = DnDate, CardCode = "C1", SourceOrderDocNum = 7001,
        HasChitaSignature = signed, OpenLinesCount = open, SourceOrderInvoicedDirectly = direct, Comments = comments
    };

    [Fact]
    public void Delivered_and_signed_is_invoiced_on_the_receipt_date()
    {
        var v = HomeDeliveryEligibility.Decide(C(), new DateOnly(2026, 11, 23));
        Assert.Equal(HomeDeliveryDecision.Invoice, v.Decision);
        Assert.Equal(new DateOnly(2026, 11, 23), v.InvoiceDate);
    }

    [Fact]
    public void Invoice_is_never_dated_before_the_delivery_note()
        => Assert.Equal(DnDate, HomeDeliveryEligibility.Decide(C(), DnDate.AddDays(-3)).InvoiceDate);

    [Theory]
    [InlineData(false, 2, false, null, HomeDeliveryDecision.AwaitingSignature)]
    [InlineData(true, 0, false, null, HomeDeliveryDecision.AlreadyInvoiced)]
    [InlineData(true, 2, true, null, HomeDeliveryDecision.OrderInvoicedDirectly)]
    [InlineData(true, 2, false, "משלוח קונסיגנציה", HomeDeliveryDecision.Consignment)]
    public void Every_doubt_blocks_the_invoice(bool signed, int open, bool direct, string? comments, HomeDeliveryDecision expected)
    {
        var v = HomeDeliveryEligibility.Decide(C(signed, open, direct, comments), new DateOnly(2026, 11, 23));
        Assert.Equal(expected, v.Decision);
        Assert.Null(v.InvoiceDate);
    }

    [Fact]
    public void Not_in_cheetah_map_is_a_branch_delivery()
        => Assert.Equal(HomeDeliveryDecision.NotCheetah, HomeDeliveryEligibility.Decide(C(), null).Decision);
}

public class ChitaReceiptDatesTests
{
    [Fact]
    public void Parses_company_map_and_drops_malformed_entries()
    {
        var d = ChitaReceiptDates.Parse(
            """{"OIG":{"7001":"2026-11-23","bad":"2026-11-23","7002":"23/11/2026"},"UNICO":{"9":"2026-11-01"}}""",
            DateTimeOffset.UtcNow);
        Assert.Equal(new DateOnly(2026, 11, 23), d.ReceiptDate("OIG", 7001));
        Assert.Null(d.ReceiptDate("OIG", 7002));
        Assert.Null(d.ReceiptDate("OIG", 9));
        Assert.Equal(new DateOnly(2026, 11, 1), d.ReceiptDate("unico", 9));
        Assert.Equal(2, d.SkippedEntries);
    }
}

public class HomeDeliveryInvoicingModuleTests
{
    private sealed class FixedClock(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
        public override TimeZoneInfo LocalTimeZone => TimeZoneInfo.Utc;
    }

    private sealed class FakeReadModel : IHomeDeliveryReadModel
    {
        public List<HomeDeliveryCandidate> Items { get; } = [];
        public Task<IReadOnlyList<HomeDeliveryCandidate>> GetCandidatesAsync(DateOnly from, IReadOnlyCollection<string> fc, CancellationToken ct)
            => Task.FromResult<IReadOnlyList<HomeDeliveryCandidate>>(Items);
    }

    private sealed class FakeDates(ChitaReceiptDates? d) : IChitaReceiptDatesSource
    {
        public Task<ChitaReceiptDates?> LoadAsync(CancellationToken ct) => Task.FromResult(d);
    }

    private sealed class FakePublisher : IFilePublisher
    {
        public List<(string File, byte[] Content)> Shadow { get; } = [];
        public Task PublishAsync(string m, string f, byte[] c, CancellationToken ct) => Task.CompletedTask;
        public Task WriteShadowCopyAsync(string m, string f, byte[] c, CancellationToken ct) { Shadow.Add((f, c)); return Task.CompletedTask; }
    }

    private static readonly DateTimeOffset Now = new(2026, 11, 28, 19, 0, 0, TimeSpan.Zero);
    private readonly FakeSapGateway _sap = new();
    private readonly FakeReadModel _rm = new();
    private readonly FakePublisher _pub = new();

    private static ChitaReceiptDates Dates(string json, DateTimeOffset? written = null) =>
        ChitaReceiptDates.Parse(json, written ?? Now.AddHours(-2));

    private HomeDeliveryInvoicingModule Sut(ChitaReceiptDates? dates) =>
        new(_sap, _rm, new FakeDates(dates), _pub, new HomeDeliverySettings(),
            NullLogger<HomeDeliveryInvoicingModule>.Instance, new FixedClock(Now));

    private static HomeDeliveryCandidate C(int dn, int order, bool signed = true) => new()
    {
        DnDocEntry = dn, DnDocNum = 5000 + dn, DnDate = new DateOnly(2026, 11, 25), CardCode = "C1",
        SourceOrderDocNum = order, HasChitaSignature = signed, OpenLinesCount = 1, SourceOrderInvoicedDirectly = false
    };

    [Fact]
    public async Task Shadow_reports_decisions_and_creates_nothing()
    {
        _rm.Items.AddRange([C(1, 7001), C(2, 7002, signed: false), C(3, 9999)]);
        var r = await Sut(Dates("""{"OIG":{"7001":"2026-11-27","7002":"2026-11-27"}}""")).GenerateOutboundAsync(true, default);

        Assert.Equal(ProcessingStatus.Succeeded, r.Status);
        Assert.Empty(_sap.CreatedInvoices);
        var csv = System.Text.Encoding.UTF8.GetString(Assert.Single(_pub.Shadow).Content);
        Assert.Contains("5001,", csv);
        Assert.Contains("AwaitingSignature", csv);
        Assert.DoesNotContain("5003,", csv); // branch delivery not in the report
    }

    [Fact]
    public async Task Live_invoices_only_signed_cheetah_deliveries_on_receipt_date()
    {
        _rm.Items.AddRange([C(1, 7001), C(2, 7002, signed: false), C(3, 9999)]);
        var r = await Sut(Dates("""{"OIG":{"7001":"2026-11-27","7002":"2026-11-27"}}""")).GenerateOutboundAsync(false, default);

        Assert.Equal(ProcessingStatus.Succeeded, r.Status);
        var inv = Assert.Single(_sap.CreatedInvoices);
        Assert.Equal(1, inv.BaseDeliveryNoteDocEntry);
        Assert.Equal(new DateOnly(2026, 11, 27), inv.DocDate);
        Assert.Empty(_pub.Shadow);
    }

    [Fact]
    public async Task Missing_receipt_file_is_a_fault_not_an_empty_run()
    {
        _rm.Items.Add(C(1, 7001));
        var r = await Sut(null).GenerateOutboundAsync(false, default);
        Assert.Equal(ProcessingStatus.Faulted, r.Status);
        Assert.Empty(_sap.CreatedInvoices);
    }

    [Fact]
    public async Task Long_unsigned_delivery_and_stale_receipt_file_raise_alerts()
    {
        _rm.Items.Add(C(2, 7002, signed: false));
        var r = await Sut(Dates("""{"OIG":{"7002":"2026-11-20"}}""", Now.AddDays(-3))).GenerateOutboundAsync(true, default);
        Assert.Equal(ProcessingStatus.Faulted, r.Status);
        Assert.Contains("חתימה", r.FaultDetail);
        Assert.Contains("Cheetah Daily", r.FaultDetail);
    }

    [Fact]
    public async Task One_failed_invoice_does_not_block_the_others()
    {
        _rm.Items.AddRange([C(1, 7001), C(2, 7002)]);
        _sap.FailInvoice = d => d.BaseDeliveryNoteDocEntry == 1 ? new InvalidOperationException("period locked") : null;
        var r = await Sut(Dates("""{"OIG":{"7001":"2026-11-27","7002":"2026-11-27"}}""")).GenerateOutboundAsync(false, default);

        Assert.Equal(ProcessingStatus.Faulted, r.Status);
        Assert.Contains("5001", r.FaultDetail);
        Assert.Equal(2, Assert.Single(_sap.CreatedInvoices).BaseDeliveryNoteDocEntry);
    }
}
