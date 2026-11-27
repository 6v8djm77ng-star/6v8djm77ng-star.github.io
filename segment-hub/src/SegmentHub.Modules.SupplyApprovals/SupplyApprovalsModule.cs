using Microsoft.Extensions.Logging;
using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Enums;
using SegmentHub.Domain.Model;

namespace SegmentHub.Modules.SupplyApprovals;

/// <summary>
/// Reference inbound module: Supply Approval (Entry_* file, ממשק 11) -> A/R invoice in SAP.
/// The whole pipeline is explicit and linear: decode -> parse -> validate -> map -> post.
/// In shadow mode it does everything except the final post, so we can prove parity with EasySale
/// against production data at zero risk.
/// </summary>
public sealed class SupplyApprovalsModule : ISegmentModule
{
    public const string ModuleKey = "SupplyApprovals";
    private const string Encoding = "utf-8";

    private readonly IFileDecoder _decoder;
    private readonly IRecordParser<SupplyApproval> _parser;
    private readonly IRecordValidator<SupplyApproval> _validator;
    private readonly IDocumentMapper<SupplyApproval, InvoiceDraft> _mapper;
    private readonly ISapGateway _sap;
    private readonly ILogger<SupplyApprovalsModule> _log;

    public SupplyApprovalsModule(
        IFileDecoder decoder,
        IRecordParser<SupplyApproval> parser,
        IRecordValidator<SupplyApproval> validator,
        IDocumentMapper<SupplyApproval, InvoiceDraft> mapper,
        ISapGateway sap,
        ILogger<SupplyApprovalsModule> log)
    {
        _decoder = decoder;
        _parser = parser;
        _validator = validator;
        _mapper = mapper;
        _sap = sap;
        _log = log;
    }

    public string Key => ModuleKey;
    public InterfaceDirection Direction => InterfaceDirection.Inbound;

    public async Task<ProcessingResult> ProcessInboundAsync(SegmentFile file, bool shadowMode, CancellationToken ct)
    {
        using var scope = _log.BeginScope("file:{File} shadow:{Shadow}", file.Name, shadowMode);
        try
        {
            var text = _decoder.Decode(file.Content, Encoding);

            var parsed = _parser.Parse(file.Name, text);
            if (!parsed.Ok)
                return Rejected(file, parsed.Rejection!, shadowMode);

            var approval = parsed.Value!;

            var invalid = await _validator.ValidateAsync(approval, ct);
            if (invalid is not null)
                return Rejected(file, invalid, shadowMode);

            var draft = await _mapper.MapAsync(approval, ct);

            if (shadowMode)
            {
                _log.LogInformation("SHADOW ok: would invoice DN {Dn} card {Card} total {Total}",
                    draft.BaseDeliveryNoteDocEntry, draft.CardCode, draft.ExpectedTotal);
                return ProcessingResult.Ok(file.Name, "Invoice", docEntry: null, shadow: true);
            }

            var docEntry = await _sap.CreateInvoiceFromDeliveryNoteAsync(draft, ct);
            _log.LogInformation("Created invoice DocEntry {DocEntry} from file {File}", docEntry, file.Name);
            return ProcessingResult.Ok(file.Name, "Invoice", docEntry, shadow: false);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            // Unexpected: a bug or SAP/infra problem. Faulted is retryable; it is never swallowed.
            _log.LogError(ex, "Fault processing {File}", file.Name);
            return ProcessingResult.Fault(file.Name, ex.Message, shadowMode);
        }
    }

    private ProcessingResult Rejected(SegmentFile file, RejectionReason reason, bool shadow)
    {
        // A rejection is expected and explainable — logged at Warning with its code, never hidden.
        _log.LogWarning("Rejected {File}: {Reason}", file.Name, reason);
        return ProcessingResult.Reject(file.Name, reason, shadow);
    }
}
