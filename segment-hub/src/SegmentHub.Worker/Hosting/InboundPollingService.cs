using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Enums;
using SegmentHub.Domain.Model;
using SegmentHub.Infrastructure.Configuration;

namespace SegmentHub.Worker.Hosting;

/// <summary>
/// Drives every inbound module on its own interval: dequeue -> process -> audit -> archive.
/// Shadow mode is resolved per interface (global default, overridable), so interfaces can be
/// flipped to live one at a time at cutover. A fault raises an alert; a rejection does not.
/// </summary>
public sealed class InboundPollingService : BackgroundService
{
    private readonly IReadOnlyList<ISegmentModule> _modules;
    private readonly IFileQueue _queue;
    private readonly IProcessingAuditStore _audit;
    private readonly IShadowComparer _shadow;
    private readonly IAlertSink _alerts;
    private readonly HubOptions _opt;
    private readonly ILogger<InboundPollingService> _log;

    public InboundPollingService(
        IEnumerable<ISegmentModule> modules,
        IFileQueue queue,
        IProcessingAuditStore audit,
        IShadowComparer shadow,
        IAlertSink alerts,
        IOptions<HubOptions> opt,
        ILogger<InboundPollingService> log)
    {
        _modules = modules.Where(m => m.Direction == InterfaceDirection.Inbound).ToList();
        _queue = queue;
        _audit = audit;
        _shadow = shadow;
        _alerts = alerts;
        _opt = opt.Value;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _log.LogInformation("Hub starting. Global shadow mode: {Shadow}. Modules: {Modules}",
            _opt.ShadowMode, string.Join(", ", _modules.Select(m => m.Key)));

        var loops = _modules
            .Where(m => InterfaceCfg(m.Key).Enabled)
            .Select(m => RunModuleLoop(m, stoppingToken));
        await Task.WhenAll(loops);
    }

    private async Task RunModuleLoop(ISegmentModule module, CancellationToken ct)
    {
        var cfg = InterfaceCfg(module.Key);
        var delay = TimeSpan.FromSeconds(Math.Max(5, cfg.PollSeconds));
        var shadow = cfg.ShadowMode ?? _opt.ShadowMode;

        while (!ct.IsCancellationRequested)
        {
            try
            {
                var files = await _queue.DequeueInboundAsync(module.Key, _opt.Queue.MaxBatch, ct);
                foreach (var file in files)
                {
                    var result = (await module.ProcessInboundAsync(file, shadow, ct)) with { ModuleKey = module.Key };
                    await _audit.RecordAsync(result, ct);
                    if (result.ShadowMode) await _shadow.CompareAsync(result, ct);
                    await _queue.ArchiveAsync(module.Key, file.Name, result.Status != ProcessingStatus.Faulted, ct);

                    if (result.Status == ProcessingStatus.Faulted)
                        await _alerts.RaiseAsync($"Hub fault: {module.Key}",
                            $"{file.Name}: {result.FaultDetail}", ct);
                }
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                _log.LogError(ex, "Module loop {Module} crashed; backing off", module.Key);
                await _alerts.RaiseAsync($"Hub module loop crashed: {module.Key}", ex.Message, ct);
            }

            try { await Task.Delay(delay, ct); } catch (OperationCanceledException) { break; }
        }
    }

    private InterfaceOptions InterfaceCfg(string key) =>
        _opt.Interfaces.TryGetValue(key, out var c) ? c : new InterfaceOptions();
}
