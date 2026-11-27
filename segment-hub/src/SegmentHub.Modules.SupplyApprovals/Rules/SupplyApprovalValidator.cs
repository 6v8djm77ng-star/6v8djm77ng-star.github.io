using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Enums;
using SegmentHub.Domain.Model;

namespace SegmentHub.Modules.SupplyApprovals.Rules;

/// <summary>
/// Business validation for a supply approval before we try to create an invoice.
/// This is where the chronic EasySale failure is turned from a silent crash into an explicit,
/// logged rejection: if the delivery note cannot be linked, we say so with a code and the raw ref.
/// </summary>
public sealed class SupplyApprovalValidator : IRecordValidator<SupplyApproval>
{
    private readonly ISapGateway _sap;

    public SupplyApprovalValidator(ISapGateway sap) => _sap = sap;

    public async Task<RejectionReason?> ValidateAsync(SupplyApproval approval, CancellationToken ct)
    {
        if (approval.Lines.Count == 0)
            return new RejectionReason(RejectionCode.MalformedFile, "אין שורות באישור האספקה");

        var dnRef = approval.DeliveryNoteRef;
        if (!dnRef.IsNumeric)
            return new RejectionReason(RejectionCode.LinkedDeliveryNoteNotFound,
                $"מספר תעודת משלוח לא מספרי: '{dnRef.Raw}'");

        // All lines must point at the same delivery note; a mixed file is malformed.
        if (approval.Lines.Any(l => l.DeliveryNoteRef.Normalized != dnRef.Normalized))
            return new RejectionReason(RejectionCode.MalformedFile, "שורות עם תעודות משלוח שונות באותו קובץ");

        // One file is one approval (EasySale groups by NumAtCard). Several approvals in one file
        // would be silently merged, so reject explicitly rather than invoice the wrong lines.
        var numAtCard = approval.Lines[0].NumAtCard;
        if (approval.Lines.Any(l => l.NumAtCard != numAtCard))
            return new RejectionReason(RejectionCode.MalformedFile, "מספר אישורי אספקה באותו קובץ אינו נתמך");

        // The DN DocNum is unique in SAP, so the lookup keys on it; the customer card is an advisory hint.
        var cardCode = approval.Lines[0].CardCode;

        var dn = await _sap.FindOpenDeliveryNoteAsync(dnRef, cardCode, ct);
        if (dn is null)
            return new RejectionReason(RejectionCode.LinkedDeliveryNoteNotFound,
                $"לא נמצאה תעודת משלוח פתוחה {dnRef.Normalized} (גולמי: '{dnRef.Raw}') עבור לקוח {cardCode}");

        if (!dn.IsOpen)
            return new RejectionReason(RejectionCode.DeliveryNoteAlreadyInvoiced,
                $"תעודת משלוח {dn.DocNum} כבר חויבה");

        return null; // valid
    }
}
