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
    public List<InvoiceForHundredFile> PendingInvoices { get; set; } = [];
    public List<int> MarkedAsReported { get; } = [];
    public List<(int DocEntry, DeliveryNoteAction Action)> UpdatedDeliveryNotes { get; } = [];

    public Task<DeliveryNoteHandle?> FindOpenDeliveryNoteAsync(DocumentKey dn, string fatherCard, CancellationToken ct)
        => Task.FromResult(NextDeliveryNote);

    public Task<bool> ItemExistsAsync(string itemCode, CancellationToken ct)
        => Task.FromResult(NextItemExists);

    public Task<int> CreateInvoiceFromDeliveryNoteAsync(InvoiceDraft draft, CancellationToken ct)
        => Task.FromResult(NextDocEntry);

    public Task<bool> SalesOrderExistsAsync(string electraOrderRef, string fatherCard, CancellationToken ct)
        => Task.FromResult(NextOrderExists);

    public Task<int> CreateSalesOrderAsync(SalesOrderDraft draft, CancellationToken ct)
        => Task.FromResult(NextDocEntry);

    public Task UpdateDeliveryNoteStatusAsync(int docEntry, DeliveryNoteAction action, CancellationToken ct)
    {
        UpdatedDeliveryNotes.Add((docEntry, action));
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<InvoiceForHundredFile>> GetPendingHundredFileInvoicesAsync(DateOnly from, DateOnly to, CancellationToken ct)
        => Task.FromResult<IReadOnlyList<InvoiceForHundredFile>>(PendingInvoices);

    public Task MarkInvoicesAsReportedAsync(IReadOnlyList<int> sapDocEntries, CancellationToken ct)
    {
        MarkedAsReported.AddRange(sapDocEntries);
        return Task.CompletedTask;
    }
}
