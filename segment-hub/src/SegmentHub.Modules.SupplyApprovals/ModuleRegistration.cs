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
    /// Wires the Supply Approvals interface. The approval file carries the customer card directly,
    /// and the DN lookup keys on the (unique) DocNum, so no branch→father-card resolver is needed.
    /// </summary>
    public static IServiceCollection AddSupplyApprovalsModule(this IServiceCollection services)
    {
        services.AddSingleton<IRecordParser<SupplyApproval>, EntryFileParser>();

        services.AddSingleton<IRecordValidator<SupplyApproval>>(sp =>
            new SupplyApprovalValidator(sp.GetRequiredService<ISapGateway>()));

        services.AddSingleton<IDocumentMapper<SupplyApproval, InvoiceDraft>>(sp =>
            new SupplyApprovalToInvoiceMapper(sp.GetRequiredService<ISapGateway>()));

        services.AddSingleton<ISegmentModule, SupplyApprovalsModule>();
        return services;
    }
}
