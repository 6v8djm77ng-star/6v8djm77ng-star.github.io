using SegmentHub.Domain.Model;

namespace SegmentHub.Modules.HomeDelivery;

/// <summary>
/// Pure rules: may this delivery note be invoiced now? Proof of delivery = Cheetah status "Delivered"
/// as tracked by oig-electra-worker. Every "skip" rule is checked before "invoice", so a doubt never
/// produces an invoice.
/// </summary>
public static class HomeDeliveryEligibility
{
    public const string ConsignmentMarker = "קונסיגנציה";

    public static HomeDeliveryVerdict Decide(
        HomeDeliveryCandidate c,
        ChitaShipmentStatus? status,
        string deliveredStatus,
        IReadOnlyCollection<string> refusedStatuses,
        TimeZoneInfo localZone)
    {
        if (status is null)
            return new(HomeDeliveryDecision.NotCheetah, null, "לא במעקב ציטה (אספקה לסניף) — מטופל באישורי אספקה");

        // The status file names its own DN. If it is not this one, the link is wrong — never bill on it.
        if (status.DeliveryNote != c.DnDocNum && status.DeliveryNote != c.DnDocEntry)
            return new(HomeDeliveryDecision.KeyMismatch, null, $"קובץ הסטטוס מצביע על ת.מ {status.DeliveryNote}, לא על {c.DnDocNum}");

        if (refusedStatuses.Contains(status.Status, StringComparer.OrdinalIgnoreCase))
            return new(HomeDeliveryDecision.Refused, null, $"הלקוח סירב ({status.Status}) — לא לחייב, נדרש טיפול בהחזרה");

        if (c.Comments?.Contains(ConsignmentMarker, StringComparison.Ordinal) == true)
            return new(HomeDeliveryDecision.Consignment, null, "קונסיגנציה — לא מחויב במסירה");

        if (c.OpenLinesCount <= 0)
            return new(HomeDeliveryDecision.AlreadyInvoiced, null, "אין שורות פתוחות — כבר חויב");

        if (c.SourceOrderInvoicedDirectly)
            return new(HomeDeliveryDecision.OrderInvoicedDirectly, null, "הזמנת המקור חויבה ישירות — חיוב נוסף יהיה כפול");

        if (!string.Equals(status.Status, deliveredStatus, StringComparison.OrdinalIgnoreCase))
            return new(HomeDeliveryDecision.InTransit, null, $"בדרך ({status.Status})");

        // Invoice on the day Cheetah confirmed delivery (local time), never before the DN itself.
        var delivered = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(status.UpdatedUtc, localZone).DateTime);
        return new(HomeDeliveryDecision.Invoice, delivered < c.DnDate ? c.DnDate : delivered, "נמסר (ציטה)");
    }
}
