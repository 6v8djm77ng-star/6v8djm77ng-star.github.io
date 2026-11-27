using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Enums;
using SegmentHub.Domain.Model;

namespace SegmentHub.Modules.DeliveryNotes.Rules;

/// <summary>
/// Business validation for a delivery note status update before we apply it in SAP.
/// Checks that the DN exists and that the status transition makes sense.
/// </summary>
public sealed class DeliveryNoteValidator : IRecordValidator<DeliveryNoteStatusFile>
{
    private readonly ISapGateway _sap;
    private readonly Func<string, string> _fatherCardResolver;

    public DeliveryNoteValidator(ISapGateway sap, Func<string, string> fatherCardResolver)
    {
        _sap = sap;
        _fatherCardResolver = fatherCardResolver;
    }

    public async Task<RejectionReason?> ValidateAsync(DeliveryNoteStatusFile file, CancellationToken ct)
    {
        if (file.Lines.Count == 0)
            return new RejectionReason(RejectionCode.MalformedFile, "אין שורות בקובץ סטטוס תעודת משלוח");

        var dnRef = file.DeliveryNoteRef;
        if (!dnRef.IsNumeric)
            return new RejectionReason(RejectionCode.LinkedDeliveryNoteNotFound,
                $"מספר תעודת משלוח לא מספרי: '{dnRef.Raw}'");

        // All lines must reference the same DN.
        if (file.Lines.Any(l => l.DeliveryNoteRef.Normalized != dnRef.Normalized))
            return new RejectionReason(RejectionCode.MalformedFile, "שורות עם תעודות משלוח שונות באותו קובץ");

        // Unknown action is suspicious but not necessarily blocking — log-only in production.
        if (file.Lines.Any(l => l.Action == DeliveryNoteAction.Unknown))
            return new RejectionReason(RejectionCode.DeliveryNoteStatusMismatch,
                $"קוד פעולה לא מוכר בשורה עם DN {dnRef.Normalized}");

        var fatherCard = _fatherCardResolver(file.Lines[0].BranchCode);
        var dn = await _sap.FindOpenDeliveryNoteAsync(dnRef, fatherCard, ct);

        if (dn is null)
            return new RejectionReason(RejectionCode.LinkedDeliveryNoteNotFound,
                $"לא נמצאה תעודת משלוח {dnRef.Normalized} (גולמי: '{dnRef.Raw}') עבור כרטיס אב {fatherCard}");

        // A returned DN that's already closed can't be returned again.
        if (!dn.IsOpen && file.Lines[0].Action == DeliveryNoteAction.Returned)
            return new RejectionReason(RejectionCode.DeliveryNoteStatusMismatch,
                $"תעודת משלוח {dn.DocNum} כבר סגורה, לא ניתן להחזיר");

        return null;
    }
}
