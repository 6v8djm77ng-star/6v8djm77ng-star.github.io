using Microsoft.Extensions.DependencyInjection;
using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Model;
using SegmentHub.Modules.DeliveryNotes.Parsing;
using SegmentHub.Modules.DeliveryNotes.Rules;

namespace SegmentHub.Modules.DeliveryNotes;

public static class ModuleRegistration
{
    public static IServiceCollection AddDeliveryNotesModule(
        this IServiceCollection services,
        Func<IServiceProvider, Func<string, string>> fatherCardResolverFactory)
    {
        services.AddSingleton<IRecordParser<DeliveryNoteStatusFile>, DeliveryNoteFileParser>();

        services.AddSingleton<IRecordValidator<DeliveryNoteStatusFile>>(sp =>
            new DeliveryNoteValidator(sp.GetRequiredService<ISapGateway>(), fatherCardResolverFactory(sp)));

        services.AddSingleton<Func<string, string>>(sp => fatherCardResolverFactory(sp));

        services.AddSingleton<ISegmentModule, DeliveryNotesModule>();
        return services;
    }
}
