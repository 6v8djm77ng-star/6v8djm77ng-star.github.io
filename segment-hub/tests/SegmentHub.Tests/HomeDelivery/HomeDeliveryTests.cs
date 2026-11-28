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
    private static readonly string[] Refused = ["Refuse"];

    private static HomeDeliveryCandidate C(int open = 2, bool direct = false, string? comments = null) => new()
    {
        DnDocEntry = 1, DnDocNum = 5001, DnDate = DnDate, CardCode = "C1", NumAtCard = "999000001",
        OpenLinesCount = open, SourceOrderInvoicedDirectly = direct, Comments = comments
    };

    private static ChitaShipmentStatus S(string status = "Delivered", int dn = 5001, string updated = "2026-11-23T21:30:00Z") =>
        new("999000001", status, status is "Delivered" or "Refuse", dn, DateTimeOffset.Parse(updated));

    private static HomeDeliveryVerdict D(HomeDeliveryCandidate c, ChitaShipmentStatus? s, TimeZoneInfo? z = null) =>
        HomeDeliveryEligibility.Decide(c, s, "Delivered", Refused, z ?? TimeZoneInfo.Utc);

    [Fact]
    public void Delivered_is_invoiced_on_the_local_delivery_day()
    {
        var israelLike = TimeZoneInfo.CreateCustomTimeZone("IL", TimeSpan.FromHours(2), "IL", "IL");
        var v = D(C(), S(), israelLike); // 21:30Z = 23:30 local, still the 23rd
        Assert.Equal(HomeDeliveryDecision.Invoice, v.Decision);
        Assert.Equal(new DateOnly(2026, 11, 23), v.InvoiceDate);
        Assert.Equal(new DateOnly(2026, 11, 24), D(C(), S(updated: "2026-11-23T22:30:00Z"), israelLike).InvoiceDate);
    }

    [Fact]
    public void Invoice_is_never_dated_before_the_delivery_note()
        => Assert.Equal(DnDate, D(C(), S(updated: "2026-11-10T10:00:00Z")).InvoiceDate);

    [Fact]
    public void Status_pointing_to_another_delivery_note_is_never_billed()
        => Assert.Equal(HomeDeliveryDecision.KeyMismatch, D(C(), S(dn: 7777)).Decision);

    [Fact]
    public void Status_may_reference_the_doc_entry_instead_of_doc_num()
        => Assert.Equal(HomeDeliveryDecision.Invoice, D(C(), S(dn: 1)).Decision);

    [Theory]
    [InlineData("Refuse", 2, false, null, HomeDeliveryDecision.Refused)]
    [InlineData("Onitsway", 2, false, null, HomeDeliveryDecision.InTransit)]
    [InlineData("Collected", 2, false, null, HomeDeliveryDecision.InTransit)]
    [InlineData("Delivered", 0, false, null, HomeDeliveryDecision.AlreadyInvoiced)]
    [InlineData("Delivered", 2, true, null, HomeDeliveryDecision.OrderInvoicedDirectly)]
    [InlineData("Delivered", 2, false, "משלוח קונסיגנציה", HomeDeliveryDecision.Consignment)]
    public void Every_doubt_blocks_the_invoice(string status, int open, bool direct, string? comments, HomeDeliveryDecision expected)
    {
        var v = D(C(open, direct, comments), S(status));
        Assert.Equal(expected, v.Decision);
        Assert.Null(v.InvoiceDate);
    }

    [Fact]
    public void Not_tracked_by_cheetah_is_a_branch_delivery()
        => Assert.Equal(HomeDeliveryDecision.NotCheetah, D(C(), null).Decision);
}

public class ChitaStatusSnapshotTests
{
    [Fact]
    public void Parses_entries_and_drops_malformed_ones()
    {
        var s = ChitaStatusSnapshot.Parse("""
            {"999000001":{"Status":"Delivered","Terminal":true,"DeliveryNote":5001,"UpdatedUtc":"2026-11-26T09:59:39.9993899Z"},
             "999000002":{"Status":"Onitsway","Terminal":false,"DeliveryNote":"x","UpdatedUtc":"2026-11-26T09:59:39Z"},
             "999000003":"garbage"}
            """, DateTimeOffset.UtcNow);
        var d = s.ForOrder(" 999000001 ");
        Assert.NotNull(d);
        Assert.Equal(5001, d!.DeliveryNote);
        Assert.True(d.Terminal);
        Assert.Null(s.ForOrder("999000002"));
        Assert.Equal(2, s.SkippedEntries);
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

    private sealed class FakeStatuses(ChitaStatusSnapshot? s) : IChitaStatusSource
    {
        public Task<ChitaStatusSnapshot?> LoadAsync(CancellationToken ct) => Task.FromResult(s);
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

    private static string E(int dn, string status, string updated = "2026-11-28T10:00:00Z") =>
        $$"""
        "99900000{{dn}}":{"Status":"{{status}}","Terminal":{{(status is "Delivered" or "Refuse" ? "true" : "false")}},"DeliveryNote":{{5000 + dn}},"UpdatedUtc":"{{updated}}"}
        """;

    private static ChitaStatusSnapshot Snap(params string[] entries) =>
        ChitaStatusSnapshot.Parse("{" + string.Join(",", entries) + "}", Now.AddHours(-1));

    private HomeDeliveryInvoicingModule Sut(ChitaStatusSnapshot? s) =>
        new(_sap, _rm, new FakeStatuses(s), _pub, new HomeDeliverySettings(),
            NullLogger<HomeDeliveryInvoicingModule>.Instance, new FixedClock(Now));

    private static HomeDeliveryCandidate C(int dn, DateOnly? date = null) => new()
    {
        DnDocEntry = dn, DnDocNum = 5000 + dn, DnDate = date ?? new DateOnly(2026, 11, 25), CardCode = "C1",
        NumAtCard = $"99900000{dn}", OpenLinesCount = 1, SourceOrderInvoicedDirectly = false
    };

    private static HomeDeliveryCandidate Branch() => new()
    {
        DnDocEntry = 9, DnDocNum = 6009, DnDate = new DateOnly(2026, 11, 25), CardCode = "C9",
        NumAtCard = "103000009", OpenLinesCount = 1, SourceOrderInvoicedDirectly = false
    };

    [Fact]
    public async Task Shadow_reports_decisions_and_creates_nothing()
    {
        _rm.Items.AddRange([C(1), C(2), Branch()]);
        var r = await Sut(Snap(E(1, "Delivered"), E(2, "Onitsway"))).GenerateOutboundAsync(true, default);

        Assert.Equal(ProcessingStatus.Succeeded, r.Status);
        Assert.Empty(_sap.CreatedInvoices);
        var csv = System.Text.Encoding.UTF8.GetString(Assert.Single(_pub.Shadow).Content);
        Assert.Contains("5001,", csv);
        Assert.Contains("InTransit", csv);
        Assert.DoesNotContain("6009,", csv); // branch delivery not in the report
    }

    [Fact]
    public async Task Live_invoices_only_delivered_shipments_on_the_delivery_day()
    {
        _rm.Items.AddRange([C(1), C(2), Branch()]);
        var r = await Sut(Snap(E(1, "Delivered", "2026-11-27T08:00:00Z"), E(2, "Collected"))).GenerateOutboundAsync(false, default);

        Assert.Equal(ProcessingStatus.Succeeded, r.Status);
        var inv = Assert.Single(_sap.CreatedInvoices);
        Assert.Equal(1, inv.BaseDeliveryNoteDocEntry);
        Assert.Equal(new DateOnly(2026, 11, 27), inv.DocDate);
        Assert.Empty(_pub.Shadow);
    }

    [Fact]
    public async Task Missing_status_file_is_a_fault_not_an_empty_run()
    {
        _rm.Items.Add(C(1));
        var r = await Sut(null).GenerateOutboundAsync(false, default);
        Assert.Equal(ProcessingStatus.Faulted, r.Status);
        Assert.Empty(_sap.CreatedInvoices);
    }

    [Fact]
    public async Task Frozen_statuses_while_shipments_are_moving_raise_an_alert()
    {
        _rm.Items.Add(C(1));
        var r = await Sut(Snap(E(1, "Delivered", "2026-11-24T09:59:00Z"), E(2, "Onitsway", "2026-11-24T09:59:00Z")))
            .GenerateOutboundAsync(true, default);
        Assert.Equal(ProcessingStatus.Faulted, r.Status);
        Assert.Contains("ציטה", r.FaultDetail);
    }

    [Fact]
    public async Task Quiet_weekend_is_not_an_alert()
    {
        _rm.Items.Add(C(1));
        var r = await Sut(Snap(E(1, "Delivered", "2026-11-26T09:59:00Z"), E(2, "Onitsway", "2026-11-26T09:59:00Z")))
            .GenerateOutboundAsync(true, default);
        Assert.Equal(ProcessingStatus.Succeeded, r.Status);
    }

    [Fact]
    public async Task Refused_and_long_in_transit_deliveries_are_alerted_not_billed()
    {
        _rm.Items.AddRange([C(1), C(2, new DateOnly(2026, 11, 10))]);
        var r = await Sut(Snap(E(1, "Refuse"), E(2, "Onitsway"))).GenerateOutboundAsync(false, default);

        Assert.Equal(ProcessingStatus.Faulted, r.Status);
        Assert.Contains("5001", r.FaultDetail);
        Assert.Contains("5002", r.FaultDetail);
        Assert.Empty(_sap.CreatedInvoices);
    }

    [Fact]
    public async Task One_failed_invoice_does_not_block_the_others()
    {
        _rm.Items.AddRange([C(1), C(2)]);
        _sap.FailInvoice = d => d.BaseDeliveryNoteDocEntry == 1 ? new InvalidOperationException("period locked") : null;
        var r = await Sut(Snap(E(1, "Delivered"), E(2, "Delivered"))).GenerateOutboundAsync(false, default);

        Assert.Equal(ProcessingStatus.Faulted, r.Status);
        Assert.Contains("5001", r.FaultDetail);
        Assert.Equal(2, Assert.Single(_sap.CreatedInvoices).BaseDeliveryNoteDocEntry);
    }
}
