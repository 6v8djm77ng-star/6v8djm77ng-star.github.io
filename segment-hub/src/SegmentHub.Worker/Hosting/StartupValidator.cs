using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SegmentHub.Infrastructure.Configuration;

namespace SegmentHub.Worker.Hosting;

public sealed class StartupValidator : IHostedService
{
    private readonly HubOptions _opt;
    private readonly IConfiguration _config;
    private readonly ILogger<StartupValidator> _log;

    public StartupValidator(IOptions<HubOptions> opt, IConfiguration config, ILogger<StartupValidator> log)
    {
        _opt = opt.Value;
        _config = config;
        _log = log;
    }

    public Task StartAsync(CancellationToken ct)
    {
        _log.LogInformation("╔══════════════════════════════════════════════╗");
        _log.LogInformation("║  OIG Segment Integration Hub                ║");
        _log.LogInformation("║  .NET 9 · Clean Architecture · Shadow Mode  ║");
        _log.LogInformation("╚══════════════════════════════════════════════╝");

        var errors = new List<string>();

        if (string.IsNullOrWhiteSpace(_opt.ServiceLayer.BaseUrl))
            errors.Add("Hub:ServiceLayer:BaseUrl is empty");

        if (string.IsNullOrWhiteSpace(_opt.ServiceLayer.UserName))
            errors.Add("Hub:ServiceLayer:UserName is empty");

        var connStr = _config.GetConnectionString("SapCompany");
        if (string.IsNullOrWhiteSpace(connStr))
            errors.Add("ConnectionStrings:SapCompany is empty");

        var enabledInterfaces = _opt.Interfaces
            .Where(kv => kv.Value.Enabled)
            .Select(kv => kv.Key)
            .ToList();

        if (enabledInterfaces.Count == 0)
            errors.Add("No interfaces are enabled");

        if (!string.IsNullOrEmpty(_opt.Queue.RootPath) && !Directory.Exists(_opt.Queue.RootPath))
            _log.LogWarning("Queue root path does not exist: {Path}. Files won't be dequeued until it is created.", _opt.Queue.RootPath);

        _log.LogInformation("Global shadow mode: {Shadow}", _opt.ShadowMode);
        _log.LogInformation("Enabled interfaces: {Interfaces}", string.Join(", ", enabledInterfaces));

        foreach (var iface in enabledInterfaces)
        {
            var cfg = _opt.Interfaces[iface];
            var mode = cfg.ShadowMode ?? _opt.ShadowMode;
            _log.LogInformation("  {Interface}: shadow={Shadow}, poll={Poll}s",
                iface, mode, cfg.PollSeconds);
        }

        if (errors.Count > 0)
        {
            foreach (var e in errors)
                _log.LogCritical("Configuration error: {Error}", e);
            throw new InvalidOperationException(
                $"SegmentHub startup blocked by {errors.Count} configuration error(s). See logs above.");
        }

        _log.LogInformation("Configuration validated. Hub ready.");
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;
}
