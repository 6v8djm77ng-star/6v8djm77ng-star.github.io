using Microsoft.Extensions.DependencyInjection;
using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Model;
using SegmentHub.Modules.Orders.Mapping;
using SegmentHub.Modules.Orders.Parsing;
using SegmentHub.Modules.Orders.Rules;

namespace SegmentHub.Modules.Orders;

public static class ModuleRegistration
{
    public static IServiceCollection AddOrdersModule(
        this IServiceCollection services,
        Func<IServiceProvider, Func<string, string>> fatherCardResolverFactory)
    {
        services.AddSingleton<OrderFileParser>();
        services.AddSingleton<IRecordParser<ElectraOrder>>(sp => sp.GetRequiredService<OrderFileParser>());

        services.AddSingleton<IRecordValidator<ElectraOrder>>(sp =>
            new OrderValidator(sp.GetRequiredService<ISapGateway>(), fatherCardResolverFactory(sp)));

        services.AddSingleton<IDocumentMapper<ElectraOrder, SalesOrderDraft>>(sp =>
            new OrderToSalesOrderMapper(fatherCardResolverFactory(sp)));

        services.AddSingleton<ISegmentModule, OrdersModule>();
        return services;
    }
}
