using SegmentHub.Domain.Model;

namespace SegmentHub.Application.Abstractions;

/// <summary>Read-only view of open Segment delivery notes that may be Cheetah home deliveries.</summary>
public interface IHomeDeliveryReadModel
{
    Task<IReadOnlyList<HomeDeliveryCandidate>> GetCandidatesAsync(
        DateOnly from, IReadOnlyCollection<string> fatherCards, CancellationToken ct);
}

/// <summary>
/// Cheetah statuses of Segment home deliveries, as already tracked by oig-electra-worker
/// (state\prod-status.json). Reused as-is — the hub never calls Cheetah itself.
/// </summary>
public interface IChitaStatusSource
{
    /// <summary>Null when the file is missing or unreadable — the caller must treat that as a fault, not as "nothing delivered".</summary>
    Task<ChitaStatusSnapshot?> LoadAsync(CancellationToken ct);
}

/// <summary>Settings for the home-delivery invoicing flow (section Hub:HomeDelivery).</summary>
public sealed class HomeDeliverySettings
{
    public const string SectionName = "Hub:HomeDelivery";

    /// <summary>Segment father cards whose delivery notes are considered.</summary>
    public List<string> FatherCards { get; set; } = ["2005000", "2004999", "2005207"];

    /// <summary>electra-worker's state\prod-status.json. Set per machine (not committed).</summary>
    public string StatusFilePath { get; set; } = "";

    public string DeliveredStatus { get; set; } = "Delivered";
    public List<string> RefusedStatuses { get; set; } = ["Refuse"];

    public int LookbackDays { get; set; } = 60;

    /// <summary>No status change for this long while shipments are still in transit → the Cheetah link is down.</summary>
    public int StaleStatusHours { get; set; } = 24;

    /// <summary>In transit longer than this → alert.</summary>
    public int InTransitAlertDays { get; set; } = 7;
}
