using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Enums;
using SegmentHub.Infrastructure.Configuration;

namespace SegmentHub.Worker.Hosting;

/// <summary>
/// Drives outbound modules on their configured schedule.
/// HundredFile runs daily ~16:00; other outbound modules may have different cadences.
/// A fault raises an alert. Shadow mode is resolved per interface.
/// </summary>
public sealed class OutboundSchedulingService : BackgroundService
{
    private readonly IReadOnlyList<IOutboundModule> _modules;
    private readonly IProcessingAuditStore _audit;
    private readonly IAlertSink _alerts;
    private readonly HubOptions _opt;
    private readonly ILogger<OutboundSchedulingService> _log;

    public OutboundSchedulingService(
        IEnumerable<IOutboundModule> modules,
        IProcessingAuditStore audit,
        IAlertSink alerts,
        IOptions<HubOptions> opt,
        ILogger<OutboundSchedulingService> log)
    {
        _modules = modules.ToList();
        _audit = audit;
        _alerts = alerts;
        _opt = opt.Value;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _log.LogInformation("Outbound scheduler starting. Modules: {Modules}",
            string.Join(", ", _modules.Select(m => m.Key)));

        var loops = _modules
            .Where(m => InterfaceCfg(m.Key).Enabled)
            .Select(m => RunModuleLoop(m, stoppingToken));
        await Task.WhenAll(loops);
    }

    private async Task RunModuleLoop(IOutboundModule module, CancellationToken ct)
    {
        var cfg = InterfaceCfg(module.Key);
        var shadow = cfg.ShadowMode ?? _opt.ShadowMode;

        while (!ct.IsCancellationRequested)
        {
            var nextRun = CalculateNextRun(cfg);
            var delay = nextRun - DateTime.Now;
            if (delay > TimeSpan.Zero)
            {
                _log.LogInformation("Outbound {Module}: next run at {NextRun}", module.Key, nextRun);
                try { await Task.Delay(delay, ct); } catch (OperationCanceledException) { break; }
            }

            try
            {
                var result = await module.GenerateOutboundAsync(shadow, ct);
                result = result with { ModuleKey = module.Key };
                await _audit.RecordAsync(result, ct);

                if (result.Status == ProcessingStatus.Faulted)
                    await _alerts.RaiseAsync($"Hub outbound fault: {module.Key}",
                        $"{result.SourceFileName}: {result.FaultDetail}", ct);
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                _log.LogError(ex, "Outbound module loop {Module} crashed; backing off", module.Key);
                await _alerts.RaiseAsync($"Hub outbound crashed: {module.Key}", ex.Message, ct);
            }

            // After a run, wait at least 1 hour before checking the schedule again.
            try { await Task.Delay(TimeSpan.FromHours(1), ct); } catch (OperationCanceledException) { break; }
        }
    }

    private static DateTime CalculateNextRun(InterfaceOptions cfg)
    {
        var runHour = cfg.OutboundRunHour > 0 ? cfg.OutboundRunHour : 16;
        var today = DateTime.Today.AddHours(runHour);
        return DateTime.Now < today ? today : today.AddDays(1);
    }

    private InterfaceOptions InterfaceCfg(string key) =>
        _opt.Interfaces.TryGetValue(key, out var c) ? c : new InterfaceOptions();
}
