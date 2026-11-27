using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Model;

namespace SegmentHub.Infrastructure.Sap;

/// <summary>
/// SAP Business One Service Layer implementation of <see cref="ISapGateway"/>.
/// NOTE: this is the production-shape skeleton. The query/post bodies are wired to the Service Layer
/// REST contract; final field names must be confirmed against the live metadata before cutover.
/// Login/session handling is kept minimal here and should move to a DelegatingHandler with retry.
/// </summary>
public sealed class ServiceLayerSapGateway : ISapGateway
{
    private readonly HttpClient _http;
    private readonly ILogger<ServiceLayerSapGateway> _log;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public ServiceLayerSapGateway(HttpClient http, ILogger<ServiceLayerSapGateway> log)
    {
        _http = http;
        _log = log;
    }

    public async Task<DeliveryNoteHandle?> FindOpenDeliveryNoteAsync(DocumentKey dn, string fatherCard, CancellationToken ct)
    {
        if (!dn.IsNumeric) return null;

        // Service Layer OData: open delivery notes (ODLN) whose DocNum matches, for customers under the father card.
        // $filter on DocNum + DocumentStatus; we resolve the customer set from the father card server-side in prod.
        var url = $"DeliveryNotes?$select=DocEntry,DocNum,CardCode,DocumentStatus" +
                  $"&$filter=DocNum eq {dn.Normalized} and DocumentStatus eq 'bost_Open'&$top=1";

        using var resp = await _http.GetAsync(url, ct);
        if (!resp.IsSuccessStatusCode)
        {
            _log.LogWarning("Service Layer DN query {Status} for DocNum {Dn}", resp.StatusCode, dn.Normalized);
            return null;
        }

        var page = await resp.Content.ReadFromJsonAsync<ODataPage<DeliveryNoteDto>>(Json, ct);
        var hit = page?.Value.FirstOrDefault();
        if (hit is null) return null;

        return new DeliveryNoteHandle(hit.DocEntry, hit.DocNum, hit.CardCode, IsOpen: true);
    }

    public async Task<bool> ItemExistsAsync(string itemCode, CancellationToken ct)
    {
        var url = $"Items('{Uri.EscapeDataString(itemCode)}')?$select=ItemCode,Valid";
        using var resp = await _http.GetAsync(url, ct);
        return resp.IsSuccessStatusCode;
    }

    public async Task<int> CreateInvoiceFromDeliveryNoteAsync(InvoiceDraft draft, CancellationToken ct)
    {
        // A/R invoice drawn from a delivery note: one DocumentLine with BaseType 15 (ODLN), BaseEntry = DN DocEntry.
        var body = new
        {
            CardCode = draft.CardCode,
            DocumentLines = new[]
            {
                new { BaseType = 15, BaseEntry = draft.BaseDeliveryNoteDocEntry, BaseLine = 0 }
            }
        };

        using var resp = await _http.PostAsJsonAsync("Invoices", body, Json, ct);
        if (!resp.IsSuccessStatusCode)
        {
            var detail = await resp.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException($"Service Layer invoice post failed ({resp.StatusCode}): {detail}");
        }

        var created = await resp.Content.ReadFromJsonAsync<DeliveryNoteDto>(Json, ct);
        return created?.DocEntry ?? throw new InvalidOperationException("Invoice created but no DocEntry returned.");
    }

    public async Task<bool> SalesOrderExistsAsync(string electraOrderRef, string fatherCard, CancellationToken ct)
    {
        var url = $"Orders?$select=DocEntry&$filter=NumAtCard eq '{Uri.EscapeDataString(electraOrderRef)}'&$top=1";
        using var resp = await _http.GetAsync(url, ct);
        if (!resp.IsSuccessStatusCode) return false;
        var page = await resp.Content.ReadFromJsonAsync<ODataPage<DocEntryDto>>(Json, ct);
        return page?.Value.Count > 0;
    }

    public async Task<int> CreateSalesOrderAsync(SalesOrderDraft draft, CancellationToken ct)
    {
        var body = new
        {
            CardCode = draft.CardCode,
            NumAtCard = draft.ElectraOrderRef,
            DocDate = draft.OrderDate.ToString("yyyy-MM-dd"),
            DocDueDate = draft.DeliveryDate.ToString("yyyy-MM-dd"),
            Comments = draft.IsHomeDelivery
                ? $"בית לקוח: {draft.CustomerName} {draft.CustomerPhone} {draft.CustomerAddress} {draft.CustomerCity}"
                : null,
            DocumentLines = draft.Lines.Select(l => new
            {
                l.ItemCode,
                ItemDescription = l.Description,
                l.Quantity,
                UnitPrice = l.UnitPrice,
                DiscountPercent = l.Discount,
                WarehouseCode = l.WarehouseCode
            }).ToArray()
        };

        using var resp = await _http.PostAsJsonAsync("Orders", body, Json, ct);
        if (!resp.IsSuccessStatusCode)
        {
            var detail = await resp.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException($"Service Layer order post failed ({resp.StatusCode}): {detail}");
        }

        var created = await resp.Content.ReadFromJsonAsync<DocEntryDto>(Json, ct);
        return created?.DocEntry ?? throw new InvalidOperationException("Order created but no DocEntry returned.");
    }

    public async Task UpdateDeliveryNoteStatusAsync(int docEntry, Domain.Enums.DeliveryNoteAction action, CancellationToken ct)
    {
        // Close = cancel the document; Return = cancel then copy; Partial = keep open.
        if (action == Domain.Enums.DeliveryNoteAction.Returned)
        {
            using var resp = await _http.PostAsync($"DeliveryNotes({docEntry})/Cancel", null, ct);
            if (!resp.IsSuccessStatusCode)
            {
                var detail = await resp.Content.ReadAsStringAsync(ct);
                _log.LogWarning("DN cancel failed for {DocEntry}: {Status} {Detail}", docEntry, resp.StatusCode, detail);
            }
        }
        else if (action == Domain.Enums.DeliveryNoteAction.Delivered)
        {
            using var resp = await _http.PostAsync($"DeliveryNotes({docEntry})/Close", null, ct);
            if (!resp.IsSuccessStatusCode)
            {
                var detail = await resp.Content.ReadAsStringAsync(ct);
                _log.LogWarning("DN close failed for {DocEntry}: {Status} {Detail}", docEntry, resp.StatusCode, detail);
            }
        }
    }

    public async Task<IReadOnlyList<InvoiceForHundredFile>> GetPendingHundredFileInvoicesAsync(DateOnly from, DateOnly to, CancellationToken ct)
    {
        var url = $"Invoices?$select=DocEntry,DocNum,CardCode,CardName,DocDate,DocTotal,VatSum" +
                  $"&$filter=DocDate ge '{from:yyyy-MM-dd}' and DocDate le '{to:yyyy-MM-dd}'" +
                  $" and U_HundredFileSent ne 'Y'&$orderby=DocNum";

        using var resp = await _http.GetAsync(url, ct);
        if (!resp.IsSuccessStatusCode)
        {
            _log.LogWarning("HundredFile invoice query failed: {Status}", resp.StatusCode);
            return [];
        }

        var page = await resp.Content.ReadFromJsonAsync<ODataPage<InvoiceDto>>(Json, ct);
        if (page is null) return [];

        return page.Value.Select(i => new InvoiceForHundredFile
        {
            InvoiceNumber = i.DocNum.ToString(),
            InvoiceDate = DateOnly.Parse(i.DocDate),
            CustomerCode = i.CardCode,
            CustomerName = i.CardName ?? "",
            NetAmount = i.DocTotal - i.VatSum,
            VatAmount = i.VatSum,
            TotalAmount = i.DocTotal,
            SapDocEntry = i.DocEntry
        }).ToList();
    }

    public async Task MarkInvoicesAsReportedAsync(IReadOnlyList<int> sapDocEntries, CancellationToken ct)
    {
        foreach (var entry in sapDocEntries)
        {
            var body = new { U_HundredFileSent = "Y" };
            using var resp = await _http.PatchAsJsonAsync($"Invoices({entry})", body, Json, ct);
            if (!resp.IsSuccessStatusCode)
                _log.LogWarning("Failed to mark invoice {DocEntry} as sent: {Status}", entry, resp.StatusCode);
        }
    }

    private sealed record ODataPage<T>(IReadOnlyList<T> Value);
    private sealed record DeliveryNoteDto(int DocEntry, int DocNum, string CardCode, string? DocumentStatus);
    private sealed record DocEntryDto(int DocEntry);
    private sealed record InvoiceDto(int DocEntry, int DocNum, string CardCode, string? CardName, string DocDate, decimal DocTotal, decimal VatSum);
}
