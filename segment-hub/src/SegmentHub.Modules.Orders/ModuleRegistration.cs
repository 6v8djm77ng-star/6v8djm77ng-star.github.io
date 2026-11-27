using Microsoft.Extensions.DependencyInjection;
using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Model;
using SegmentHub.Modules.Orders.Mapping;
using SegmentHub.Modules.Orders.Parsing;
using SegmentHub.Modules.Orders.Rules;

namespace SegmentHub.Modules.Orders;

public static class ModuleRegistration
{
    public static IServiceCollection AddOrdersModule(this IServiceCollection services)
    {
        services.AddSingleton<OrderFileParser>();
        services.AddSingleton<IRecordParser<ElectraOrder>>(sp => sp.GetRequiredService<OrderFileParser>());

        services.AddSingleton<IRecordValidator<ElectraOrder>>(sp =>
            new OrderValidator(sp.GetRequiredService<ISapGateway>()));

        services.AddSingleton<IDocumentMapper<ElectraOrder, SalesOrderDraft>>(_ => new OrderToSalesOrderMapper());

        services.AddSingleton<ISegmentModule, OrdersModule>();
        return services;
    }
}
