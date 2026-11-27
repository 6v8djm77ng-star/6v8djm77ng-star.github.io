namespace SegmentHub.Domain.Model;

/// <summary>
/// Proof-of-delivery for a home-delivery (B2C) order delivered by Cheetah (צ'יטה).
/// For these orders (Electra order 999...) the invoice must be issued only once Cheetah reports the
/// shipment delivered AND signed. This is the trigger EasySale never automated.
///
/// The source of this POD (poll Cheetah's API vs. a POD file relayed through Segment / ממשק 12) is
/// deliberately abstracted behind <c>ICheetahPodSource</c>; this record is the stable fact either way.
/// </summary>
public sealed record HomeDeliveryPod
{
    /// <summary>Electra home-delivery order reference (999...). The link back to the SAP document.</summary>
    public required DocumentKey ElectraOrderRef { get; init; }

    /// <summary>Cheetah shipment / tracking number.</summary>
    public required string CheetahTrackingNumber { get; init; }

    public required DateTimeOffset DeliveredAt { get; init; }

    /// <summary>
    /// True only when Cheetah confirms a signed delivery. A "delivered but unsigned" POD is a distinct,
    /// explicit state — the business decides whether that also invoices (see spec question 5.4).
    /// </summary>
    public required bool IsSigned { get; init; }

    public string? RecipientName { get; init; }

    /// <summary>Verbatim status payload from Cheetah, kept for audit and dispute resolution.</summary>
    public string? RawStatus { get; init; }
}
