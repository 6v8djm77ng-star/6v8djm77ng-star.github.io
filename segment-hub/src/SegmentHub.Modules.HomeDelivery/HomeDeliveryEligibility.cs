using SegmentHub.Domain.Model;

namespace SegmentHub.Modules.HomeDelivery;

/// <summary>
/// Pure rules: may this delivery note be invoiced now? Mirrors the proven rules of the OIG auto-invoice
/// app (Cheetah receipt + signed POD attachment + double-billing guard), scoped to Segment.
/// Order matters: every "skip" rule is checked before "invoice", so a doubt never produces an invoice.
/// </summary>
public static class HomeDeliveryEligibility
{
    public const string ConsignmentMarker = "קונסיגנציה";

    public static HomeDeliveryVerdict Decide(HomeDeliveryCandidate c, DateOnly? chitaReceiptDate)
    {
        if (chitaReceiptDate is null)
            return new(HomeDeliveryDecision.NotCheetah, null, "לא משלוח ציטה (אספקה לסניף) — מטופל באישורי אספקה");

        if (c.Comments?.Contains(ConsignmentMarker, StringComparison.Ordinal) == true)
            return new(HomeDeliveryDecision.Consignment, null, "קונסיגנציה — לא מחויב במסירה");

        if (c.OpenLinesCount <= 0)
            return new(HomeDeliveryDecision.AlreadyInvoiced, null, "אין שורות פתוחות — כבר חויב");

        if (c.SourceOrderInvoicedDirectly)
            return new(HomeDeliveryDecision.OrderInvoicedDirectly, null, "הזמנת המקור חויבה ישירות — חיוב נוסף יהיה כפול");

        if (!c.HasChitaSignature)
            return new(HomeDeliveryDecision.AwaitingSignature, null, "נמסר בציטה, חסרה חתימה מצורפת ב-SAP");

        // Never date the invoice before the delivery note itself.
        var date = chitaReceiptDate.Value < c.DnDate ? c.DnDate : chitaReceiptDate.Value;
        return new(HomeDeliveryDecision.Invoice, date, "נמסר ונחתם");
    }
}
