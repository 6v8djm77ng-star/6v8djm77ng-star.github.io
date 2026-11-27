using Microsoft.Extensions.Logging;
using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Enums;
using SegmentHub.Domain.Model;
using SegmentHub.Modules.Orders.Parsing;

namespace SegmentHub.Modules.Orders;

/// <summary>
/// Inbound module: Electra order file (ממשק 1) -> Sales Order(s) in SAP.
/// One file may contain multiple orders; each is processed independently.
/// Pipeline: decode → parse → validate → map → post (or shadow log).
/// </summary>
public sealed class OrdersModule : ISegmentModule
{
    public const string ModuleKeyValue = "Orders";
    private const string FileEncoding = "windows-1255";

    private readonly IFileDecoder _decoder;
    private readonly OrderFileParser _parser;
    private readonly IRecordValidator<ElectraOrder> _validator;
    private readonly IDocumentMapper<ElectraOrder, SalesOrderDraft> _mapper;
    private readonly ISapGateway _sap;
    private readonly ILogger<OrdersModule> _log;

    public OrdersModule(
        IFileDecoder decoder,
        OrderFileParser parser,
        IRecordValidator<ElectraOrder> validator,
        IDocumentMapper<ElectraOrder, SalesOrderDraft> mapper,
        ISapGateway sap,
        ILogger<OrdersModule> log)
    {
        _decoder = decoder;
        _parser = parser;
        _validator = validator;
        _mapper = mapper;
        _sap = sap;
        _log = log;
    }

    public string Key => ModuleKeyValue;
    public InterfaceDirection Direction => InterfaceDirection.Inbound;

    public async Task<ProcessingResult> ProcessInboundAsync(SegmentFile file, bool shadowMode, CancellationToken ct)
    {
        using var scope = _log.BeginScope("file:{File} shadow:{Shadow}", file.Name, shadowMode);
        try
        {
            var text = _decoder.Decode(file.Content, FileEncoding);

            var parsed = _parser.ParseAll(file.Name, text);
            if (!parsed.Ok)
                return Rejected(file, parsed.Rejection!, shadowMode);

            var orders = parsed.Value!;
            int created = 0;
            var rejected = new List<string>();

            foreach (var order in orders)
            {
                var invalid = await _validator.ValidateAsync(order, ct);
                if (invalid is not null)
                {
                    _log.LogWarning("Rejected order {Order}: {Reason}", order.OrderNumber, invalid);
                    rejected.Add($"{order.OrderNumber} [{(int)invalid.Code}] {invalid.Message}");
                    continue;
                }

                var draft = await _mapper.MapAsync(order, ct);

                if (shadowMode)
                {
                    _log.LogInformation("SHADOW ok: would create SO for Electra order {Ref} card {Card} lines {Lines}",
                        draft.ElectraOrderRef, draft.CardCode, draft.Lines.Count);
                }
                else
                {
                    var docEntry = await _sap.CreateSalesOrderAsync(draft, ct);
                    _log.LogInformation("Created SO DocEntry {DocEntry} for Electra order {Ref}", docEntry, draft.ElectraOrderRef);
                }
                created++;
            }

            // A multi-order file where some orders were rejected must not look clean. Per-order
            // rejections are logged above; this summary makes the file-level outcome explicit in the
            // Serilog audit. TODO (when the SQL audit DB is wired): one audit row per order, not per file.
            if (rejected.Count > 0)
                _log.LogWarning("Orders file {File}: {Created}/{Total} processed, {Rejected} rejected — {Detail}",
                    file.Name, created, orders.Count, rejected.Count, string.Join(" | ", rejected));
            else
                _log.LogInformation("Orders file {File}: {Created} order(s) processed, 0 rejected", file.Name, created);

            return ProcessingResult.Ok(file.Name, "SalesOrder", docEntry: null, shadow: shadowMode);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            _log.LogError(ex, "Fault processing orders file {File}", file.Name);
            return ProcessingResult.Fault(file.Name, ex.Message, shadowMode);
        }
    }

    private ProcessingResult Rejected(SegmentFile file, RejectionReason reason, bool shadow)
    {
        _log.LogWarning("Rejected {File}: {Reason}", file.Name, reason);
        return ProcessingResult.Reject(file.Name, reason, shadow);
    }
}
