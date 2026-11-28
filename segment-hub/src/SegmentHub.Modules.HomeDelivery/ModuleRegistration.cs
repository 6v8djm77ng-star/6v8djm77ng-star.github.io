using Microsoft.Extensions.DependencyInjection;
using SegmentHub.Application.Abstractions;

namespace SegmentHub.Modules.HomeDelivery;

public static class ModuleRegistration
{
    public static IServiceCollection AddHomeDeliveryModule(this IServiceCollection services)
    {
        services.AddSingleton<IOutboundModule, HomeDeliveryInvoicingModule>();
        return services;
    }
}
