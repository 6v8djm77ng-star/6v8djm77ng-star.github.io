using Microsoft.Extensions.Logging;
using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Enums;
using SegmentHub.Domain.Model;

namespace SegmentHub.Modules.DeliveryNotes;

/// <summary>
/// Inbound module: Delivery Note status (ממשק 9) -> update DN status in SAP.
/// Reports B2B delivery status from Electra branches: delivered, returned, partial.
/// Same pipeline shape as SupplyApprovals: decode → parse → validate → update SAP.
/// </summary>
public sealed class DeliveryNotesModule : ISegmentModule
{
    public const string ModuleKey = "DeliveryNotes";
    private const string Encoding = "utf-8";

    private readonly IFileDecoder _decoder;
    private readonly IRecordParser<DeliveryNoteStatusFile> _parser;
    private readonly IRecordValidator<DeliveryNoteStatusFile> _validator;
    private readonly ISapGateway _sap;
    private readonly Func<string, string> _fatherCardResolver;
    private readonly ILogger<DeliveryNotesModule> _log;

    public DeliveryNotesModule(
        IFileDecoder decoder,
        IRecordParser<DeliveryNoteStatusFile> parser,
        IRecordValidator<DeliveryNoteStatusFile> validator,
        ISapGateway sap,
        Func<string, string> fatherCardResolver,
        ILogger<DeliveryNotesModule> log)
    {
        _decoder = decoder;
        _parser = parser;
        _validator = validator;
        _sap = sap;
        _fatherCardResolver = fatherCardResolver;
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

            var statusFile = parsed.Value!;

            var invalid = await _validator.ValidateAsync(statusFile, ct);
            if (invalid is not null)
                return Rejected(file, invalid, shadowMode);

            var dnRef = statusFile.DeliveryNoteRef;
            var fatherCard = _fatherCardResolver(statusFile.Lines[0].BranchCode);
            var dn = await _sap.FindOpenDeliveryNoteAsync(dnRef, fatherCard, ct);

            if (dn is null)
                return ProcessingResult.Fault(file.Name, $"DN {dnRef.Normalized} vanished between validation and update.", shadowMode);

            var action = statusFile.Lines[0].Action;

            if (shadowMode)
            {
                _log.LogInformation("SHADOW ok: would update DN {DocNum} action {Action}",
                    dn.DocNum, action);
                return ProcessingResult.Ok(file.Name, "DeliveryNoteStatus", docEntry: null, shadow: true);
            }

            await _sap.UpdateDeliveryNoteStatusAsync(dn.DocEntry, action, ct);
            _log.LogInformation("Updated DN {DocNum} DocEntry {DocEntry} action {Action}",
                dn.DocNum, dn.DocEntry, action);
            return ProcessingResult.Ok(file.Name, "DeliveryNoteStatus", dn.DocEntry, shadow: false);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Fault processing {File}", file.Name);
            return ProcessingResult.Fault(file.Name, ex.Message, shadowMode);
        }
    }

    private ProcessingResult Rejected(SegmentFile file, RejectionReason reason, bool shadow)
    {
        _log.LogWarning("Rejected {File}: {Reason}", file.Name, reason);
        return ProcessingResult.Reject(file.Name, reason, shadow);
    }
}
