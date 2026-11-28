using SegmentHub.Domain.Model;

namespace SegmentHub.Application.Abstractions;

/// <summary>Read-only view of open Segment delivery notes that may be Cheetah home deliveries.</summary>
public interface IHomeDeliveryReadModel
{
    Task<IReadOnlyList<HomeDeliveryCandidate>> GetCandidatesAsync(
        DateOnly from, IReadOnlyCollection<string> fatherCards, CancellationToken ct);
}

/// <summary>
/// Cheetah receipt dates per source order, produced daily by the existing "Cheetah Daily" job
/// (chita-receipt-dates.json). Reused as-is — no direct Cheetah API call from the hub.
/// </summary>
public interface IChitaReceiptDatesSource
{
    /// <summary>Returns null when the file is missing or unreadable — the caller must treat that as a fault, not as "no deliveries".</summary>
    Task<ChitaReceiptDates?> LoadAsync(CancellationToken ct);
}

/// <summary>Settings for the home-delivery invoicing flow (section Hub:HomeDelivery).</summary>
public sealed class HomeDeliverySettings
{
    public const string SectionName = "Hub:HomeDelivery";

    /// <summary>Segment father cards whose delivery notes are considered.</summary>
    public List<string> FatherCards { get; set; } = ["2005000", "2004999", "2005207"];

    /// <summary>Set via env Hub__HomeDelivery__ChitaDatesPath (internal share path — not committed).</summary>
    public string ChitaDatesPath { get; set; } = "";

    /// <summary>Company key inside the receipt-dates file ("OIG" / "UNICO").</summary>
    public string ChitaCompany { get; set; } = "OIG";

    public int LookbackDays { get; set; } = 45;

    /// <summary>Delivered by Cheetah but still unsigned after this many days → alert.</summary>
    public int UnsignedAlertDays { get; set; } = 3;

    /// <summary>Receipt-dates file older than this → alert (Cheetah Daily stopped).</summary>
    public int StaleDatesHours { get; set; } = 36;
}
