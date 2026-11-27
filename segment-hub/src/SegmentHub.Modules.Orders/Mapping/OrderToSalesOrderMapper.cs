using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Model;

namespace SegmentHub.Modules.Orders.Mapping;

/// <summary>Maps a validated ElectraOrder to a SalesOrderDraft ready for SAP.</summary>
public sealed class OrderToSalesOrderMapper : IDocumentMapper<ElectraOrder, SalesOrderDraft>
{
    private readonly Func<string, string> _fatherCardResolver;

    public OrderToSalesOrderMapper(Func<string, string> fatherCardResolver)
        => _fatherCardResolver = fatherCardResolver;

    public Task<SalesOrderDraft> MapAsync(ElectraOrder order, CancellationToken ct)
    {
        var cardCode = _fatherCardResolver(order.BranchCode);

        var lines = order.Lines.Select(l => new SalesOrderLineDraft
        {
            ItemCode = l.ItemCode,
            Description = l.Description,
            Quantity = l.Quantity,
            UnitPrice = l.UnitPrice,
            Discount = l.Discount,
            WarehouseCode = l.WarehouseCode,
            LineNumber = l.OrderLineNumber
        }).ToList();

        var draft = new SalesOrderDraft
        {
            CardCode = cardCode,
            ElectraOrderRef = order.OrderNumber,
            OrderDate = order.OrderDate,
            DeliveryDate = order.DeliveryDate,
            SourceFileName = order.SourceFileName,
            Lines = lines,
            CustomerName = NullIfEmpty(order.CustomerName),
            CustomerPhone = NullIfEmpty(order.CustomerPhone),
            CustomerAddress = NullIfEmpty(order.CustomerAddress),
            CustomerCity = NullIfEmpty(order.CustomerCity),
            IsHomeDelivery = order.IsHomeDelivery
        };

        return Task.FromResult(draft);
    }

    private static string? NullIfEmpty(string s) => string.IsNullOrWhiteSpace(s) ? null : s;
}
