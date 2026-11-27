using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Model;

namespace SegmentHub.Modules.Orders.Mapping;

/// <summary>Maps a validated ElectraOrder to a SalesOrderDraft ready for SAP.</summary>
public sealed class OrderToSalesOrderMapper : IDocumentMapper<ElectraOrder, SalesOrderDraft>
{
    public Task<SalesOrderDraft> MapAsync(ElectraOrder order, CancellationToken ct)
    {
        var lines = order.Lines.Select(l => new SalesOrderLineDraft
        {
            ItemCode = l.ItemCode,
            Description = l.Description,
            Quantity = l.Quantity,
            UnitPrice = l.UnitPrice,
            LineNumber = l.LineNumber,
            Barcode = NullIfEmpty(l.Barcode),
            FreeText = NullIfEmpty(l.FreeText)
        }).ToList();

        var draft = new SalesOrderDraft
        {
            // The order file carries the customer business partner directly (col 4).
            CardCode = order.CardCode,
            ElectraOrderRef = order.OrderNumber,
            OrderDate = order.OrderDate,
            DeliveryDate = order.DeliveryDate,
            SourceFileName = order.SourceFileName,
            Lines = lines,
            ClientAddress = NullIfEmpty(order.ClientAddress),
            IsHomeDelivery = order.IsHomeDelivery
        };

        return Task.FromResult(draft);
    }

    private static string? NullIfEmpty(string s) => string.IsNullOrWhiteSpace(s) ? null : s;
}
