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

    /// <summary>Electra order reference on the DN (999... for home deliveries). Key into the Cheetah status file.</summary>
    public string? NumAtCard { get; init; }

    public string? Comments { get; init; }

    /// <summary>Informational: a scanned/signed POD is attached in SAP. Not required — Cheetah "Delivered" is the proof.</summary>
    public bool HasPodAttachment { get; init; }

    /// <summary>DN lines still open. Zero means the DN is already fully invoiced/closed.</summary>
    public required int OpenLinesCount { get; init; }

    /// <summary>The source order was invoiced directly (not through this DN) — invoicing the DN would double-bill.</summary>
    public required bool SourceOrderInvoicedDirectly { get; init; }
}

/// <summary>Cheetah status of one home-delivery order, as tracked by the electra-worker (prod-status.json).</summary>
public sealed record ChitaShipmentStatus(string OrderRef, string Status, bool Terminal, int DeliveryNote, DateTimeOffset UpdatedUtc);

public enum HomeDeliveryDecision
{
    /// <summary>Cheetah reports Delivered — invoice now.</summary>
    Invoice,
    /// <summary>Still on its way (Collected / Onitsway ...) — wait.</summary>
    InTransit,
    /// <summary>Customer refused — never invoice; the DN needs a return/cancel by a person.</summary>
    Refused,
    /// <summary>Not tracked by Cheetah (branch delivery) — invoiced by the supply-approval flow, not here.</summary>
    NotCheetah,
    /// <summary>The status file points to a different delivery note than this one — do not trust it.</summary>
    KeyMismatch,
    /// <summary>Consignment — never invoiced on delivery.</summary>
    Consignment,
    /// <summary>No open lines — already invoiced.</summary>
    AlreadyInvoiced,
    /// <summary>Source order already billed directly — invoicing the DN would double-bill.</summary>
    OrderInvoicedDirectly
}

public sealed record HomeDeliveryVerdict(HomeDeliveryDecision Decision, DateOnly? InvoiceDate, string Reason);
