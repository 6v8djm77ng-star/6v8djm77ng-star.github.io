using Microsoft.Extensions.Logging;
using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Enums;
using SegmentHub.Domain.Model;
using SegmentHub.Modules.HundredFile.Generation;

namespace SegmentHub.Modules.HundredFile;

/// <summary>
/// Outbound module: "קובץ 100" (ממשק 7) — generates invoice confirmations from SAP and publishes to Segment.
/// Runs daily ~16:00. Queries SAP for unreported invoices, generates the fixed-width file, publishes it.
/// In shadow mode: generates and logs the file but does not publish or mark invoices as reported.
/// </summary>
public sealed class HundredFileModule : IOutboundModule
{
    public const string ModuleKey = "HundredFile";
    private const string SupplierCode = "600060078";

    private readonly ISapGateway _sap;
    private readonly IFilePublisher _publisher;
    private readonly ILogger<HundredFileModule> _log;

    public HundredFileModule(ISapGateway sap, IFilePublisher publisher, ILogger<HundredFileModule> log)
    {
        _sap = sap;
        _publisher = publisher;
        _log = log;
    }

    public string Key => ModuleKey;
    public InterfaceDirection Direction => InterfaceDirection.Outbound;

    public async Task<ProcessingResult> GenerateOutboundAsync(bool shadowMode, CancellationToken ct)
    {
        try
        {
            var today = DateOnly.FromDateTime(DateTime.Today);
            var invoices = await _sap.GetPendingHundredFileInvoicesAsync(today.AddDays(-1), today, ct);

            if (invoices.Count == 0)
            {
                _log.LogInformation("No pending invoices for קובץ 100");
                return ProcessingResult.Ok($"100_{today:yyyyMMdd}_empty.txt", "HundredFile", shadow: shadowMode);
            }

            var seq = today.DayNumber % 10000;
            var fileName = $"100_{today:yyyyMMdd}_{seq:D4}.txt";
            var content = HundredFileGenerator.Generate(SupplierCode, today.AddDays(-1), today, seq, invoices);

            _log.LogInformation("Generated קובץ 100: {FileName}, {Count} invoices, {Bytes} bytes",
                fileName, invoices.Count, content.Length);

            if (shadowMode)
            {
                _log.LogInformation("SHADOW: would publish {FileName} with {Count} invoices", fileName, invoices.Count);
                return ProcessingResult.Ok(fileName, "HundredFile", shadow: true);
            }

            await _publisher.PublishAsync(ModuleKey, fileName, content, ct);
            var docEntries = invoices.Select(i => i.SapDocEntry).ToList();
            await _sap.MarkInvoicesAsReportedAsync(docEntries, ct);

            _log.LogInformation("Published {FileName} and marked {Count} invoices as reported", fileName, invoices.Count);
            return ProcessingResult.Ok(fileName, "HundredFile", shadow: false);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Fault generating קובץ 100");
            return ProcessingResult.Fault($"100_{DateTime.Today:yyyyMMdd}.txt", ex.Message, shadowMode);
        }
    }
}
