using Microsoft.Extensions.DependencyInjection;
using SegmentHub.Application.Abstractions;

namespace SegmentHub.Modules.HundredFile;

public static class ModuleRegistration
{
    public static IServiceCollection AddHundredFileModule(this IServiceCollection services)
    {
        services.AddSingleton<IOutboundModule, HundredFileModule>();
        return services;
    }
}
