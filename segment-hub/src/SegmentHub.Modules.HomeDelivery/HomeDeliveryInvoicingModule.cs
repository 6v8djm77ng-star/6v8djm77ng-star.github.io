using System.Text;
using Microsoft.Extensions.Logging;
using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Enums;
using SegmentHub.Domain.Model;

namespace SegmentHub.Modules.HomeDelivery;

/// <summary>
/// Invoices Segment home deliveries (בית לקוח) once Cheetah reports them Delivered. Today this is done by hand
/// (no supply approval exists for these), so a forgotten delivery stays un-billed for weeks.
/// The delivery signal is reused from oig-electra-worker (state\prod-status.json) — no new Cheetah integration.
/// Shadow: writes a decision report (CSV) to the shadow folder and creates nothing.
/// Live: one A/R invoice per DN from its open lines, dated on the day Cheetah confirmed delivery.
/// Idempotent by construction: an invoiced DN has no open lines, so the next run skips it.
/// </summary>
public sealed class HomeDeliveryInvoicingModule : IOutboundModule
{
    public const string ModuleKey = "HomeDeliveryInvoicing";

    private readonly ISapGateway _sap;
    private readonly IHomeDeliveryReadModel _readModel;
    private readonly IChitaStatusSource _statuses;
    private readonly IFilePublisher _publisher;
    private readonly HomeDeliverySettings _settings;
    private readonly ILogger<HomeDeliveryInvoicingModule> _log;
    private readonly TimeProvider _clock;

    public HomeDeliveryInvoicingModule(
        ISapGateway sap,
        IHomeDeliveryReadModel readModel,
        IChitaStatusSource statuses,
        IFilePublisher publisher,
        HomeDeliverySettings settings,
        ILogger<HomeDeliveryInvoicingModule> log,
        TimeProvider? clock = null)
    {
        _sap = sap;
        _readModel = readModel;
        _statuses = statuses;
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
            var snapshot = await _statuses.LoadAsync(ct);
            if (snapshot is null)
                return ProcessingResult.Fault(runName,
                    $"קובץ סטטוסי ציטה לא נמצא/לא קריא ({_settings.StatusFilePath}) — לא מחייבים בלי הוכחת מסירה", shadowMode);

            var failures = new List<string>();
            var zone = _clock.LocalTimeZone;
            var refused = _settings.RefusedStatuses;

            // A frozen file while shipments are still moving means the Cheetah link is down
            // (token expired, account blocked) — deliveries will silently stop being billed.
            var lastChange = snapshot.All.Count == 0 ? snapshot.FileWrittenUtc : snapshot.All.Max(x => x.UpdatedUtc);
            var silentHours = (now - lastChange).TotalHours;
            if (snapshot.All.Any(x => !x.Terminal) && silentHours > _settings.StaleStatusHours)
                failures.Add($"אין עדכון סטטוס מציטה {silentHours:0} שעות בזמן שיש משלוחים בדרך — בדוק את החיבור של electra-worker לציטה");

            var candidates = await _readModel.GetCandidatesAsync(
                today.AddDays(-_settings.LookbackDays), _settings.FatherCards.Distinct().ToArray(), ct); // binder appends config to defaults

            var report = new StringBuilder("DN,DnDate,CardCode,OrderRef,ChitaStatus,ChitaUpdated,Decision,InvoiceDate,Reason\r\n");
            int invoiced = 0, inTransit = 0, notCheetah = 0, skipped = 0;

            foreach (var c in candidates)
            {
                ct.ThrowIfCancellationRequested();
                var status = snapshot.ForOrder(c.NumAtCard);
                var verdict = HomeDeliveryEligibility.Decide(c, status, _settings.DeliveredStatus, refused, zone);

                switch (verdict.Decision)
                {
                    case HomeDeliveryDecision.NotCheetah:
                        notCheetah++;
                        continue; // branch delivery — not this flow, keep the report readable

                    case HomeDeliveryDecision.InTransit:
                        inTransit++;
                        var days = today.DayNumber - c.DnDate.DayNumber;
                        if (days >= _settings.InTransitAlertDays)
                            failures.Add($"ת.מ {c.DnDocNum}: בדרך כבר {days} ימים ({status!.Status})");
                        break;

                    case HomeDeliveryDecision.Refused:
                    case HomeDeliveryDecision.KeyMismatch:
                        failures.Add($"ת.מ {c.DnDocNum}: {verdict.Reason}");
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
                                    new InvoiceDraft(c.DnDocEntry, c.CardCode, $"chita:{c.NumAtCard}", 0m, verdict.InvoiceDate), ct);
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

                report.Append($"{c.DnDocNum},{c.DnDate:yyyy-MM-dd},{Csv(c.CardCode)},{Csv(c.NumAtCard)},{Csv(status?.Status)},")
                      .Append($"{status?.UpdatedUtc:yyyy-MM-dd HH:mm},{verdict.Decision},{verdict.InvoiceDate:yyyy-MM-dd},{Csv(verdict.Reason)}\r\n");
            }

            if (shadowMode)
            {
                // UTF-8 with BOM so Excel shows Hebrew correctly.
                var bytes = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(report.ToString())).ToArray();
                await _publisher.WriteShadowCopyAsync(ModuleKey, $"{runName}.csv", bytes, ct);
            }

            _log.LogInformation(
                "משלוחי בית: {Invoiced} {Mode}, {InTransit} בדרך, {Skipped} דולגו, {NotCheetah} לא ציטה, {Failed} בעיות",
                invoiced, shadowMode ? "היו מחויבים (shadow)" : "חויבו", inTransit, skipped, notCheetah, failures.Count);

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
