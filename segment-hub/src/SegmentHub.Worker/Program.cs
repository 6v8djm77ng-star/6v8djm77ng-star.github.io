using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using SegmentHub.Infrastructure;
using SegmentHub.Infrastructure.Configuration;
using SegmentHub.Modules.DeliveryNotes;
using SegmentHub.Modules.HomeDelivery;
using SegmentHub.Modules.HundredFile;
using SegmentHub.Modules.Orders;
using SegmentHub.Modules.SupplyApprovals;
using SegmentHub.Worker.Hosting;
using Serilog;

// Serilog early, so startup failures are captured.
Log.Logger = new LoggerConfiguration()
    .WriteTo.Console()
    .WriteTo.File(@"C:\OIG-Monitor\segment-hub\logs\hub-.log", rollingInterval: RollingInterval.Day)
    .CreateBootstrapLogger();

try
{
    var builder = Host.CreateApplicationBuilder(args);

    builder.Services.AddSerilog((sp, lc) => lc
        .ReadFrom.Configuration(builder.Configuration)
        .Enrich.FromLogContext());

    builder.Services.AddSegmentHubInfrastructure(builder.Configuration);

    // Register each interface module. Adding a new interface is one line here + its module project.
    builder.Services.AddSupplyApprovalsModule();

    builder.Services.AddOrdersModule();

    builder.Services.AddDeliveryNotesModule(fatherCardResolverFactory: sp =>
    {
        var opt = sp.GetRequiredService<IOptions<HubOptions>>().Value;
        return branch => opt.FatherCardByBranch.TryGetValue(branch, out var fc) ? fc : opt.DefaultFatherCard;
    });

    builder.Services.AddHundredFileModule();

    builder.Services.AddHomeDeliveryModule();

    builder.Services.AddHostedService<StartupValidator>();
    builder.Services.AddHostedService<InboundPollingService>();
    builder.Services.AddHostedService<OutboundSchedulingService>();

    // On Windows this runs as a service; harmless elsewhere.
    builder.Services.AddWindowsService(o => o.ServiceName = "OIG Segment Integration Hub");

    await builder.Build().RunAsync();
    return 0;
}
catch (Exception ex)
{
    Log.Fatal(ex, "Segment Hub terminated unexpectedly");
    return 1;
}
finally
{
    await Log.CloseAndFlushAsync();
}
