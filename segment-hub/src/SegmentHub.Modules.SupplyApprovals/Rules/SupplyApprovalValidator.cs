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
    private readonly Func<string, string> _fatherCardResolver;

    /// <param name="fatherCardResolver">Maps a branch code to the Electra father card (2005000/2004999/2005207).</param>
    public SupplyApprovalValidator(ISapGateway sap, Func<string, string> fatherCardResolver)
    {
        _sap = sap;
        _fatherCardResolver = fatherCardResolver;
    }

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

        var fatherCard = _fatherCardResolver(approval.Lines[0].BranchCode);

        var dn = await _sap.FindOpenDeliveryNoteAsync(dnRef, fatherCard, ct);
        if (dn is null)
            return new RejectionReason(RejectionCode.LinkedDeliveryNoteNotFound,
                $"לא נמצאה תעודת משלוח פתוחה {dnRef.Normalized} (גולמי: '{dnRef.Raw}') עבור כרטיס אב {fatherCard}");

        if (!dn.IsOpen)
            return new RejectionReason(RejectionCode.DeliveryNoteAlreadyInvoiced,
                $"תעודת משלוח {dn.DocNum} כבר חויבה");

        return null; // valid
    }
}
