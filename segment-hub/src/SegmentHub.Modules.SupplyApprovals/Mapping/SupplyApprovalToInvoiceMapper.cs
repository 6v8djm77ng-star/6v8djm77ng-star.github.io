using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Model;

namespace SegmentHub.Modules.SupplyApprovals.Mapping;

/// <summary>Builds the invoice draft from a validated supply approval and the linked delivery note.</summary>
public sealed class SupplyApprovalToInvoiceMapper : IDocumentMapper<SupplyApproval, InvoiceDraft>
{
    private readonly ISapGateway _sap;

    public SupplyApprovalToInvoiceMapper(ISapGateway sap) => _sap = sap;

    public async Task<InvoiceDraft> MapAsync(SupplyApproval approval, CancellationToken ct)
    {
        var cardCode = approval.Lines[0].CardCode;
        var dn = await _sap.FindOpenDeliveryNoteAsync(approval.DeliveryNoteRef, cardCode, ct)
            ?? throw new InvalidOperationException(
                $"Delivery note {approval.DeliveryNoteRef.Normalized} vanished between validation and mapping.");

        var expectedTotal = approval.Lines.Sum(l => l.LineTotal);
        return new InvoiceDraft(dn.DocEntry, dn.CardCode, approval.SourceFileName, expectedTotal);
    }
}
