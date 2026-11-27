using Microsoft.Extensions.DependencyInjection;
using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Model;
using SegmentHub.Modules.SupplyApprovals.Mapping;
using SegmentHub.Modules.SupplyApprovals.Parsing;
using SegmentHub.Modules.SupplyApprovals.Rules;

namespace SegmentHub.Modules.SupplyApprovals;

public static class ModuleRegistration
{
    /// <summary>
    /// Wires the Supply Approvals interface. <paramref name="fatherCardResolver"/> maps a branch code to
    /// the Electra father card and is supplied by the host from HubOptions, keeping config out of the module.
    /// </summary>
    public static IServiceCollection AddSupplyApprovalsModule(
        this IServiceCollection services,
        Func<IServiceProvider, Func<string, string>> fatherCardResolverFactory)
    {
        services.AddSingleton<IRecordParser<SupplyApproval>, EntryFileParser>();

        services.AddSingleton<IRecordValidator<SupplyApproval>>(sp =>
            new SupplyApprovalValidator(sp.GetRequiredService<ISapGateway>(), fatherCardResolverFactory(sp)));

        services.AddSingleton<IDocumentMapper<SupplyApproval, InvoiceDraft>>(sp =>
            new SupplyApprovalToInvoiceMapper(sp.GetRequiredService<ISapGateway>(), fatherCardResolverFactory(sp)));

        services.AddSingleton<ISegmentModule, SupplyApprovalsModule>();
        return services;
    }
}
