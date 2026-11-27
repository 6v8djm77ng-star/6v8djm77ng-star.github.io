using SegmentHub.Domain.Model;

namespace SegmentHub.Application.Abstractions;

/// <summary>
/// Supplies proof-of-delivery events for home-delivery (B2C) orders from Cheetah.
/// Two possible implementations, chosen once the integration is confirmed:
///   (A) CheetahApiPodSource  - polls Cheetah's REST API for delivered+signed shipments (event-light, but
///                              carries Cheetah auth and must not poll cancelled orders forever).
///   (B) SegmentPodFileSource - consumes POD files relayed via Segment (ממשק 12); event-driven, no direct auth.
/// The pipeline above does not care which; it reacts to <see cref="HomeDeliveryPod"/>.
///
/// IMPORTANT: every Cheetah call in the OIG worker logs since 2026-10-12 returned 401 Unauthorized.
/// Implementation (A) is blocked until that auth is proven to work; do not build invoicing on an unverified link.
/// </summary>
public interface ICheetahPodSource
{
    /// <summary>
    /// Return newly delivered-and-signed PODs not yet processed. The source tracks its own watermark and
    /// must stop chasing orders that were cancelled/returned (the 999609281 "polls forever" bug).
    /// </summary>
    Task<IReadOnlyList<HomeDeliveryPod>> GetDeliveredSignedAsync(int max, CancellationToken ct);
}

/// <summary>Turns a confirmed home-delivery POD into an invoice draft (idempotently — one invoice per order).</summary>
public interface IHomeDeliveryInvoicer
{
    /// <summary>
    /// Find the open delivery note for the home-delivery order and build its invoice draft.
    /// Returns a rejection (never an exception) when the order has no open DN, is already invoiced,
    /// or was cancelled/returned.
    /// </summary>
    Task<OneOf<InvoiceDraft>> PrepareInvoiceAsync(HomeDeliveryPod pod, CancellationToken ct);
}
