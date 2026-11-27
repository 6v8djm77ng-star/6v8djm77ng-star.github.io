namespace SegmentHub.Domain.Model;

/// <summary>One parsed line of an Electra order (ממשק 1). 38 tab columns, Windows-1255.</summary>
public sealed record ElectraOrderLine
{
    public required string ItemCode { get; init; }
    public required string Description { get; init; }
    public required decimal Quantity { get; init; }
    public required decimal UnitPrice { get; init; }
    public required decimal Discount { get; init; }
    public required decimal LineTotal { get; init; }
    public required string ColorCode { get; init; }
    public required string SizeCode { get; init; }
    public required string ModelCode { get; init; }
    public required string WarehouseCode { get; init; }
    public required int OrderLineNumber { get; init; }
    public required string Remark { get; init; }
    public required string[] RawColumns { get; init; }
}

/// <summary>
/// An Electra order: the header + lines, parsed from one or more rows sharing the same OrderNumber.
/// B2C orders carry customer delivery info (name, phone, address, city); B2B orders have these empty.
/// </summary>
public sealed record ElectraOrder
{
    public required string SourceFileName { get; init; }
    public required string SupplierCode { get; init; }
    public required string BranchCode { get; init; }
    public required string OrderNumber { get; init; }
    public required DateOnly OrderDate { get; init; }
    public required DateOnly DeliveryDate { get; init; }
    public required string CustomerName { get; init; }
    public required string CustomerPhone { get; init; }
    public required string CustomerAddress { get; init; }
    public required string CustomerCity { get; init; }
    public required string DeliveryBranchCode { get; init; }
    public required IReadOnlyList<ElectraOrderLine> Lines { get; init; }

    /// <summary>B2C = customer delivery info is present (address or phone filled).</summary>
    public bool IsHomeDelivery =>
        !string.IsNullOrWhiteSpace(CustomerAddress) || !string.IsNullOrWhiteSpace(CustomerPhone);
}
