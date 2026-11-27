using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Enums;
using SegmentHub.Domain.Model;

namespace SegmentHub.Modules.Orders.Rules;

/// <summary>
/// Business validation for an Electra order before creating a sales order in SAP.
/// Checks supplier, dates, duplicates — explicit rejections, never silent failures.
/// </summary>
public sealed class OrderValidator : IRecordValidator<ElectraOrder>
{
    private const string SegmentSupplierCode = "600060078";

    private readonly ISapGateway _sap;
    private readonly Func<string, string> _fatherCardResolver;

    public OrderValidator(ISapGateway sap, Func<string, string> fatherCardResolver)
    {
        _sap = sap;
        _fatherCardResolver = fatherCardResolver;
    }

    public async Task<RejectionReason?> ValidateAsync(ElectraOrder order, CancellationToken ct)
    {
        if (order.Lines.Count == 0)
            return new RejectionReason(RejectionCode.EmptyOrder, "הזמנה ללא שורות");

        if (order.SupplierCode != SegmentSupplierCode)
            return new RejectionReason(RejectionCode.UnknownSupplier,
                $"קוד ספק לא מוכר: '{order.SupplierCode}' (צפוי {SegmentSupplierCode})");

        if (order.DeliveryDate < DateOnly.FromDateTime(DateTime.Today))
            return new RejectionReason(RejectionCode.InvalidDeliveryDate,
                $"תאריך אספקה בעבר: {order.DeliveryDate:yyyy-MM-dd}");

        var fatherCard = _fatherCardResolver(order.BranchCode);

        var exists = await _sap.SalesOrderExistsAsync(order.OrderNumber, fatherCard, ct);
        if (exists)
            return new RejectionReason(RejectionCode.DuplicateDocument,
                $"הזמנה {order.OrderNumber} כבר קיימת ב‑SAP");

        return null;
    }
}
