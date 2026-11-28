using System.Text;
using Microsoft.Extensions.Logging;
using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Enums;
using SegmentHub.Domain.Model;

namespace SegmentHub.Modules.HomeDelivery;

/// <summary>
/// Invoices Segment home deliveries (בית לקוח) once Cheetah delivered them and the signed POD is in SAP.
/// Signals are reused from the existing jobs — no new Cheetah integration:
///   • receipt date  ← chita-receipt-dates.json (Cheetah Daily, 08:30)
///   • signed POD    ← SAP attachment "חתימה" (Chita-POD-to-SAP, 18:00)
/// Shadow: writes a decision report (CSV) to the shadow folder and creates nothing.
/// Live: one A/R invoice per DN from its open lines, dated on the Cheetah receipt date.
/// Idempotent by construction: an invoiced DN has no open lines, so the next run skips it.
/// </summary>
public sealed class HomeDeliveryInvoicingModule : IOutboundModule
{
    public const string ModuleKey = "HomeDeliveryInvoicing";

    private readonly ISapGateway _sap;
    private readonly IHomeDeliveryReadModel _readModel;
    private readonly IChitaReceiptDatesSource _dates;
    private readonly IFilePublisher _publisher;
    private readonly HomeDeliverySettings _settings;
    private readonly ILogger<HomeDeliveryInvoicingModule> _log;
    private readonly TimeProvider _clock;

    public HomeDeliveryInvoicingModule(
        ISapGateway sap,
        IHomeDeliveryReadModel readModel,
        IChitaReceiptDatesSource dates,
        IFilePublisher publisher,
        HomeDeliverySettings settings,
        ILogger<HomeDeliveryInvoicingModule> log,
        TimeProvider? clock = null)
    {
        _sap = sap;
        _readModel = readModel;
        _dates = dates;
        _publisher = publisher;
        _settings = settings;
        _log = log;
        _clock = clock ?? TimeProvider.System;
    }

    public string Key => ModuleKey;
    public InterfaceDirection Direction => InterfaceDirection.Outbound;

    public async Task<ProcessingResult> GenerateOutboundAsync(bool shadowMode, CancellationToken ct)
    {
        var now = _clock.GetLocalNow();
        var today = DateOnly.FromDateTime(now.DateTime);
        var runName = $"home_delivery_{today:yyyyMMdd}";
        try
        {
            var dates = await _dates.LoadAsync(ct);
            if (dates is null)
                return ProcessingResult.Fault(runName,
                    $"קובץ תאריכי קבלה של ציטה לא נמצא/לא קריא ({_settings.ChitaDatesPath}) — לא מחייבים בלי הוכחת מסירה", shadowMode);

            var failures = new List<string>();
            var ageHours = (now - dates.LastWriteUtc).TotalHours;
            if (ageHours > _settings.StaleDatesHours)
                failures.Add($"קובץ תאריכי ציטה לא עודכן {ageHours:0} שעות — בדוק את Cheetah Daily");

            var candidates = await _readModel.GetCandidatesAsync(
                today.AddDays(-_settings.LookbackDays), _settings.FatherCards.Distinct().ToArray(), ct); // binder appends config to defaults

            var report = new StringBuilder("DN,DnDate,CardCode,SourceOrder,ChitaReceipt,Decision,InvoiceDate,Reason\r\n");
            int invoiced = 0, waiting = 0, notCheetah = 0, skipped = 0;

            foreach (var c in candidates)
            {
                ct.ThrowIfCancellationRequested();
                var receipt = c.SourceOrderDocNum is int o ? dates.ReceiptDate(_settings.ChitaCompany, o) : null;
                var verdict = HomeDeliveryEligibility.Decide(c, receipt);

                switch (verdict.Decision)
                {
                    case HomeDeliveryDecision.NotCheetah:
                        notCheetah++;
                        continue; // branch delivery — not this flow, keep the report readable

                    case HomeDeliveryDecision.AwaitingSignature:
                        waiting++;
                        var days = today.DayNumber - receipt!.Value.DayNumber;
                        if (days >= _settings.UnsignedAlertDays)
                            failures.Add($"ת.מ {c.DnDocNum}: נמסר בציטה לפני {days} ימים ועדיין אין חתימה ב-SAP");
                        break;

                    case HomeDeliveryDecision.Invoice:
                        if (shadowMode)
                        {
                            _log.LogInformation("משלוחי בית: WOULD-INVOICE ת.מ {Dn} ({Card}) בתאריך {Date}",
                                c.DnDocNum, c.CardCode, verdict.InvoiceDate);
                            invoiced++;
                        }
                        else
                        {
                            try
                            {
                                var entry = await _sap.CreateInvoiceFromDeliveryNoteAsync(
                                    new InvoiceDraft(c.DnDocEntry, c.CardCode, $"chita:{c.SourceOrderDocNum}", 0m, verdict.InvoiceDate), ct);
                                _log.LogInformation("משלוחי בית: נוצרה חשבונית {Inv} לת.מ {Dn}", entry, c.DnDocNum);
                                invoiced++;
                            }
                            catch (Exception ex) when (ex is InvalidOperationException or HttpRequestException)
                            {
                                failures.Add($"ת.מ {c.DnDocNum}: יצירת חשבונית נכשלה — {ex.Message}");
                                _log.LogWarning("משלוחי בית: invoice for DN {Dn} failed: {Error}", c.DnDocNum, ex.Message);
                            }
                        }
                        break;

                    default:
                        skipped++;
                        break;
                }

                report.Append($"{c.DnDocNum},{c.DnDate:yyyy-MM-dd},{Csv(c.CardCode)},{c.SourceOrderDocNum},{receipt:yyyy-MM-dd},")
                      .Append($"{verdict.Decision},{verdict.InvoiceDate:yyyy-MM-dd},{Csv(verdict.Reason)}\r\n");
            }

            if (shadowMode)
            {
                // UTF-8 with BOM so Excel shows Hebrew correctly.
                var bytes = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(report.ToString())).ToArray();
                await _publisher.WriteShadowCopyAsync(ModuleKey, $"{runName}.csv", bytes, ct);
            }

            _log.LogInformation(
                "משלוחי בית: {Invoiced} {Mode}, {Waiting} ממתינים לחתימה, {Skipped} דולגו, {NotCheetah} לא ציטה, {Failed} בעיות",
                invoiced, shadowMode ? "היו מחויבים (shadow)" : "חויבו", waiting, skipped, notCheetah, failures.Count);

            return failures.Count == 0
                ? ProcessingResult.Ok(runName, "HomeDeliveryInvoice", shadow: shadowMode)
                : ProcessingResult.Fault(runName, string.Join(" | ", failures), shadowMode);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            _log.LogError(ex, "Fault in home-delivery invoicing");
            return ProcessingResult.Fault(runName, ex.Message, shadowMode);
        }
    }

    private static string Csv(string? v) =>
        string.IsNullOrEmpty(v) ? "" : v.Contains(',') || v.Contains('"') ? $"\"{v.Replace("\"", "\"\"")}\"" : v;
}
