using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Enums;
using SegmentHub.Domain.Model;

namespace SegmentHub.Tests.Fakes;

public sealed class FakeSapGateway : ISapGateway
{
    public DeliveryNoteHandle? NextDeliveryNote { get; set; }
    public bool NextItemExists { get; set; } = true;
    public int NextDocEntry { get; set; } = 100;
    public bool NextOrderExists { get; set; }
    public List<HundredFileInvoice> PendingInvoices { get; set; } = [];
    public bool? LastIncludeReported { get; private set; }
    public List<int> MarkedAsReported { get; } = [];
    public List<(int DocEntry, DeliveryNoteAction Action)> UpdatedDeliveryNotes { get; } = [];

    public Task<DeliveryNoteHandle?> FindOpenDeliveryNoteAsync(DocumentKey dn, string fatherCard, CancellationToken ct)
        => Task.FromResult(NextDeliveryNote);

    public Task<bool> ItemExistsAsync(string itemCode, CancellationToken ct)
        => Task.FromResult(NextItemExists);

    public List<InvoiceDraft> CreatedInvoices { get; } = [];
    public Func<InvoiceDraft, Exception?>? FailInvoice { get; set; }

    public Task<int> CreateInvoiceFromDeliveryNoteAsync(InvoiceDraft draft, CancellationToken ct)
    {
        if (FailInvoice?.Invoke(draft) is { } ex) throw ex;
        CreatedInvoices.Add(draft);
        return Task.FromResult(NextDocEntry);
    }

    public Task<bool> SalesOrderExistsAsync(string electraOrderRef, string fatherCard, CancellationToken ct)
        => Task.FromResult(NextOrderExists);

    public Task<int> CreateSalesOrderAsync(SalesOrderDraft draft, CancellationToken ct)
        => Task.FromResult(NextDocEntry);

    public Task UpdateDeliveryNoteStatusAsync(int docEntry, DeliveryNoteAction action, CancellationToken ct)
    {
        UpdatedDeliveryNotes.Add((docEntry, action));
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<HundredFileInvoice>> GetPendingHundredFileInvoicesAsync(
        DateOnly from, DateOnly to, bool includeReported, CancellationToken ct)
    {
        LastIncludeReported = includeReported;
        return Task.FromResult<IReadOnlyList<HundredFileInvoice>>(PendingInvoices);
    }

    public Task MarkInvoicesAsReportedAsync(IReadOnlyList<int> sapDocEntries, CancellationToken ct)
    {
        MarkedAsReported.AddRange(sapDocEntries);
        return Task.CompletedTask;
    }
}
