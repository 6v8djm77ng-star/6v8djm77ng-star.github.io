using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Model;

namespace SegmentHub.Modules.SupplyApprovals.Mapping;

/// <summary>Builds the invoice draft from a validated supply approval and the linked delivery note.</summary>
public sealed class SupplyApprovalToInvoiceMapper : IDocumentMapper<SupplyApproval, InvoiceDraft>
{
    private readonly ISapGateway _sap;
    private readonly Func<string, string> _fatherCardResolver;

    public SupplyApprovalToInvoiceMapper(ISapGateway sap, Func<string, string> fatherCardResolver)
    {
        _sap = sap;
        _fatherCardResolver = fatherCardResolver;
    }

    public async Task<InvoiceDraft> MapAsync(SupplyApproval approval, CancellationToken ct)
    {
        var fatherCard = _fatherCardResolver(approval.Lines[0].BranchCode);
        var dn = await _sap.FindOpenDeliveryNoteAsync(approval.DeliveryNoteRef, fatherCard, ct)
            ?? throw new InvalidOperationException(
                $"Delivery note {approval.DeliveryNoteRef.Normalized} vanished between validation and mapping.");

        var expectedTotal = approval.Lines.Sum(l => l.LineTotal);
        return new InvoiceDraft(dn.DocEntry, dn.CardCode, approval.SourceFileName, expectedTotal);
    }
}
