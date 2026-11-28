namespace SegmentHub.Domain.Model;

/// <summary>
/// An open Segment delivery note that may be a Cheetah (צ'יטה) home delivery waiting for its invoice.
/// Read from SAP (read-only). Whether it is invoiced is decided by <c>HomeDeliveryEligibility</c>, never here.
/// </summary>
public sealed record HomeDeliveryCandidate
{
    public required int DnDocEntry { get; init; }
    public required int DnDocNum { get; init; }
    public required DateOnly DnDate { get; init; }
    public required string CardCode { get; init; }
    public string? FatherCard { get; init; }
    public string? Comments { get; init; }

    /// <summary>DocNum of the sales order the DN was drawn from (ORDR, BaseType 17). Key into the Cheetah receipt map.</summary>
    public int? SourceOrderDocNum { get; init; }

    /// <summary>SAP attachment whose file name contains "חתימה" — the signed POD that Chita-POD-to-SAP attaches.</summary>
    public required bool HasChitaSignature { get; init; }

    /// <summary>DN lines still open. Zero means the DN is already fully invoiced/closed.</summary>
    public required int OpenLinesCount { get; init; }

    /// <summary>The source order was invoiced directly (not through this DN) — invoicing the DN would double-bill.</summary>
    public required bool SourceOrderInvoicedDirectly { get; init; }
}

public enum HomeDeliveryDecision
{
    /// <summary>Cheetah delivered and the signed POD is in SAP — invoice now.</summary>
    Invoice,
    /// <summary>Cheetah delivered but no signed POD attached yet — wait; alert if it drags.</summary>
    AwaitingSignature,
    /// <summary>Not a Cheetah shipment (branch delivery) — invoiced by the supply-approval flow, not here.</summary>
    NotCheetah,
    /// <summary>Consignment — never invoiced on delivery.</summary>
    Consignment,
    /// <summary>No open lines — already invoiced.</summary>
    AlreadyInvoiced,
    /// <summary>Source order already billed directly — invoicing the DN would double-bill.</summary>
    OrderInvoicedDirectly
}

public sealed record HomeDeliveryVerdict(HomeDeliveryDecision Decision, DateOnly? InvoiceDate, string Reason);
