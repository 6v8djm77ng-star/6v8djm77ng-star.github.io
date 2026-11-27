namespace SegmentHub.Domain.Model;

/// <summary>
/// One parsed line of an Electra order (ממשק 1). Column indices mirror the EasySale importer
/// (ESG_SegmentFiles_API, BuildOrderItem): tab-separated, Windows-1255, no header.
/// </summary>
public sealed record ElectraOrderLine
{
    public required string ItemCode { get; init; }       // [13]
    public required string Description { get; init; }    // [14]
    public required string Barcode { get; init; }        // [16]
    public required int LineNumber { get; init; }        // [17]
    public required decimal Quantity { get; init; }      // [18]
    public required int CurrencyCode { get; init; }      // [20]
    public required decimal UnitPrice { get; init; }     // [21]
    public required decimal LineTotal { get; init; }     // [23]
    public required string FreeText { get; init; }       // [25]
    public required string[] RawColumns { get; init; }   // full verbatim row for audit
}

/// <summary>
/// An Electra order (ממשק 1): header + lines, grouped by order number + customer, exactly as the
/// EasySale importer groups rows (BuildFileOrderFormFile: new document when col[1] or col[4] changes).
/// A B2C / home-delivery order carries a client delivery address (built from cols 27,29-33); B2B does not.
/// </summary>
public sealed record ElectraOrder
{
    public required string SourceFileName { get; init; }
    public required string FatherCard { get; init; }        // [0]
    public required string OrderNumber { get; init; }       // [1] (NumAtCard)
    public required string CardCode { get; init; }          // [4] (customer business partner)
    public required DateOnly OrderDate { get; init; }       // [5] (DocDate)
    public required DateOnly DeliveryDate { get; init; }    // [6] (DocDueDate)
    public required decimal PriceWithoutVat { get; init; }  // [8]
    public required string Comments { get; init; }          // [11]
    public required string ClientAddress { get; init; }     // composite of [27],[29],[30],[31],[32],[33]
    public required IReadOnlyList<ElectraOrderLine> Lines { get; init; }

    /// <summary>B2C = a client delivery address is present.</summary>
    public bool IsHomeDelivery => !string.IsNullOrWhiteSpace(ClientAddress);
}
