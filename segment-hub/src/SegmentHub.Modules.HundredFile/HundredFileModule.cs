using Microsoft.Extensions.Logging;
using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Enums;
using SegmentHub.Domain.Model;
using SegmentHub.Modules.HundredFile.Generation;

namespace SegmentHub.Modules.HundredFile;

/// <summary>
/// Outbound module: "קובץ 100" (ממשק 7) — one fixed-width file per unreported invoice.
/// Shadow mode: files go to a local comparison folder and invoices are NOT marked as reported.
/// Live: files are published and each invoice is marked (U_ESG_100FileCreated) only after its file is written.
/// One bad invoice is reported and skipped; it never blocks the others.
/// </summary>
public sealed class HundredFileModule : IOutboundModule
{
    public const string ModuleKey = "HundredFile";

    // חשבוניות ישראל: a VAT invoice at/above this net amount needs an ITA allocation number, or the
    // Segment portal parks it as a draft ("לא הוזן מספר הקצאה"). 5,000 matches the portal's behavior
    // seen in the 28.11.2026 report (every rejected invoice >= 5,254; every accepted one below it).
    public const decimal AllocationThreshold = 5000m;

    // An invoice still waiting for its allocation after this many days means the allocation
    // process is down (as it was 13–26.11.2026) — that is an alert, not a quiet retry.
    public const int StaleAllocationDays = 2;

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
        var today = DateOnly.FromDateTime(DateTime.Today);
        var runName = $"100_run_{today:yyyyMMdd}";
        try
        {
            // Live: everything not yet reported in the last week (catches stragglers).
            // Shadow: yesterday+today INCLUDING invoices EasySale already reported, so the output can be
            // compared file-for-file with what EasySale actually sent.
            var invoices = shadowMode
                ? await _sap.GetPendingHundredFileInvoicesAsync(today.AddDays(-1), today, includeReported: true, ct)
                : await _sap.GetPendingHundredFileInvoicesAsync(today.AddDays(-7), today, includeReported: false, ct);
            if (invoices.Count == 0)
            {
                _log.LogInformation("קובץ 100: no pending invoices");
                return ProcessingResult.Ok(runName, "HundredFile", shadow: shadowMode);
            }

            var written = 0;
            var deferred = 0;
            var failures = new List<string>();
            foreach (var invoice in invoices)
            {
                ct.ThrowIfCancellationRequested();

                // Never report an invoice before its allocation number exists: that is exactly how
                // 31 invoices got stuck on 26.11 (submitted minutes before their allocations landed).
                if (NeedsAllocation(invoice) && string.IsNullOrWhiteSpace(invoice.AllocationNumber))
                {
                    var waitDays = today.DayNumber - invoice.InvoiceDate.DayNumber;
                    if (waitDays >= StaleAllocationDays)
                        failures.Add($"{invoice.InvoiceNumber}: ממתינה למספר הקצאה {waitDays} ימים — בדוק את תהליך ההקצאה");
                    else
                        deferred++;
                    _log.LogWarning("קובץ 100: invoice {Invoice} held back — no allocation number yet (net {Net}, {Days}d)",
                        invoice.InvoiceNumber, invoice.NetBeforeVat, waitDays);
                    continue;
                }

                var fileName = HundredFileGenerator.FileNameFor(invoice);
                try
                {
                    var content = HundredFileGenerator.Generate(invoice);
                    if (shadowMode)
                    {
                        await _publisher.WriteShadowCopyAsync(ModuleKey, fileName, content, ct);
                    }
                    else
                    {
                        await _publisher.PublishAsync(ModuleKey, fileName, content, ct);
                        await _sap.MarkInvoicesAsReportedAsync([invoice.SapDocEntry], ct);
                    }
                    written++;
                }
                catch (InvalidOperationException ex)
                {
                    // Data that cannot be rendered faithfully (negative amount, oversize value, no base DN).
                    _log.LogWarning("קובץ 100: invoice {Invoice} skipped: {Reason}", invoice.InvoiceNumber, ex.Message);
                    failures.Add($"{invoice.InvoiceNumber}: {ex.Message}");
                }
            }

            _log.LogInformation("קובץ 100: {Written}/{Total} files {Mode}, {Deferred} awaiting allocation, {Failed} problems",
                written, invoices.Count, shadowMode ? "written to shadow folder" : "published", deferred, failures.Count);

            return failures.Count == 0
                ? ProcessingResult.Ok(runName, "HundredFile", shadow: shadowMode)
                : ProcessingResult.Fault(runName, $"{failures.Count} invoice(s) skipped: {string.Join(" | ", failures)}", shadowMode);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            _log.LogError(ex, "Fault generating קובץ 100");
            return ProcessingResult.Fault(runName, ex.Message, shadowMode);
        }
    }

    private static bool NeedsAllocation(HundredFileInvoice i) => i.VatSum > 0 && i.NetBeforeVat >= AllocationThreshold;
}
