using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Enums;
using SegmentHub.Domain.Model;

namespace SegmentHub.Modules.Orders.Rules;

/// <summary>
/// Business validation for an Electra order before creating a sales order in SAP.
/// The order file carries its own father card (col 0) and customer (col 4); there is no supplier
/// column, so we validate structure, father card, delivery date and duplicates — explicit rejections.
/// </summary>
public sealed class OrderValidator : IRecordValidator<ElectraOrder>
{
    private readonly ISapGateway _sap;

    public OrderValidator(ISapGateway sap) => _sap = sap;

    public async Task<RejectionReason?> ValidateAsync(ElectraOrder order, CancellationToken ct)
    {
        if (order.Lines.Count == 0)
            return new RejectionReason(RejectionCode.EmptyOrder, "הזמנה ללא שורות");

        if (string.IsNullOrWhiteSpace(order.FatherCard))
            return new RejectionReason(RejectionCode.BranchNotConfigured, "כרטיס אב חסר בהזמנה");

        if (order.DeliveryDate < DateOnly.FromDateTime(DateTime.Today))
            return new RejectionReason(RejectionCode.InvalidDeliveryDate,
                $"תאריך אספקה בעבר: {order.DeliveryDate:yyyy-MM-dd}");

        var exists = await _sap.SalesOrderExistsAsync(order.OrderNumber, order.FatherCard, ct);
        if (exists)
            return new RejectionReason(RejectionCode.DuplicateDocument,
                $"הזמנה {order.OrderNumber} כבר קיימת ב‑SAP");

        return null;
    }
}
