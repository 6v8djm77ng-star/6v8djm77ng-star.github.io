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

    // Reads: case-insensitive, so SL's PascalCase JSON binds to our DTOs.
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    // Writes: Service Layer property names are case-sensitive PascalCase. Web defaults would send
    // camelCase ("cardCode", "documentLines") which SL rejects — every POST/PATCH must use this.
    private static readonly JsonSerializerOptions WriteJson = new()
    {
        PropertyNamingPolicy = null,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
    };

    private const string ReportedField = "U_ESG_100FileCreated";

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

        using var resp = await _http.PostAsJsonAsync("Invoices", body, WriteJson, ct);
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
            Comments = draft.IsHomeDelivery ? $"בית לקוח: {draft.ClientAddress}" : null,
            DocumentLines = draft.Lines.Select(l => new
            {
                l.ItemCode,
                ItemDescription = l.Description,
                l.Quantity,
                UnitPrice = l.UnitPrice
            }).ToArray()
        };

        using var resp = await _http.PostAsJsonAsync("Orders", body, WriteJson, ct);
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

    // ----- קובץ 100 (ממשק 7) -----------------------------------------------------------------
    // Mirrors the EasySale exporter's data shape. Field sources CONFIRMED from the decompiled SQL:
    //   SupplierCode = ISNULL(BP.U_ESG_SupplierCode, FatherBP.U_ESG_SupplierCode)
    //   GrossDocTotal = SUM(INV1.LineTotal), DiscountValue = OINV.DiscSum, VatSum, DocCur
    //   DN: CardCode, DocNum, DocDate, U_ESG_SupplyApproval; sent-flag = OINV.U_ESG_100FileCreated
    // ASSUMED (verify by diffing a shadow file against EasySale's file for the same invoice):
    //   NumAtCardFromPurchaseOrder = DN.NumAtCard, SubCatalogNum = line.SupplierCatNum,
    //   UnitPrice = line.UnitPrice (pre-discount), DeliveryNoteLineNum = line.BaseLine,
    //   sent-flag value 'Y'. DiscountSum / OrderLineNum / PurchaseOrderNum are left at the zero default.
    public async Task<IReadOnlyList<HundredFileInvoice>> GetPendingHundredFileInvoicesAsync(
        DateOnly from, DateOnly to, bool includeReported, CancellationToken ct)
    {
        var filter = $"DocDate ge '{from:yyyy-MM-dd}' and DocDate le '{to:yyyy-MM-dd}'";
        if (!includeReported)
            filter += $" and ({ReportedField} eq null or {ReportedField} ne 'Y')";

        var invoices = await GetAllPagesAsync<SlInvoice>(
            "Invoices?$select=DocEntry,DocNum,DocDate,CardCode,DocCurrency,TotalDiscount,VatSum,DocumentLines" +
            $"&$filter={filter}&$orderby=DocNum", ct);

        var bpCache = new Dictionary<string, SlBp?>();
        var dnCache = new Dictionary<int, SlDn?>();
        var result = new List<HundredFileInvoice>();

        foreach (var inv in invoices)
        {
            var supplierCode = await ResolveSupplierCodeAsync(inv.CardCode, bpCache, ct);
            if (string.IsNullOrWhiteSpace(supplierCode))
                continue; // no Segment supplier code on the customer or its father → not a Segment invoice

            var lines = inv.DocumentLines ?? [];
            var notes = new List<HundredFileDeliveryNote>();
            foreach (var group in lines.Where(l => l.BaseType == 15 && l.BaseEntry is not null)
                                       .GroupBy(l => l.BaseEntry!.Value))
            {
                if (!dnCache.TryGetValue(group.Key, out var dn))
                {
                    dn = await GetSingleAsync<SlDn>(
                        $"DeliveryNotes({group.Key})?$select=DocEntry,DocNum,DocDate,CardCode,NumAtCard,U_ESG_SupplyApproval", ct);
                    dnCache[group.Key] = dn;
                }
                if (dn is null) continue;

                notes.Add(new HundredFileDeliveryNote
                {
                    CardCode = dn.CardCode,
                    DocNum = dn.DocNum.ToString(),
                    DocDate = ParseSapDate(dn.DocDate),
                    SupplyApprovalNum = Str(dn.U_ESG_SupplyApproval),
                    NumAtCardFromPurchaseOrder = string.IsNullOrWhiteSpace(dn.NumAtCard) ? null : dn.NumAtCard,
                    Lines = group.Select(l => new HundredFileLine
                    {
                        SubCatalogNum = string.IsNullOrWhiteSpace(l.SupplierCatNum) ? null : l.SupplierCatNum,
                        ItemCode = l.ItemCode ?? "",
                        Quantity = l.Quantity,
                        UnitPrice = l.UnitPrice,
                        DeliveryNoteLineNum = l.BaseLine?.ToString()
                    }).ToList()
                });
            }

            result.Add(new HundredFileInvoice
            {
                SapDocEntry = inv.DocEntry,
                InvoiceNumber = inv.DocNum.ToString(),
                SupplierCode = supplierCode,
                InvoiceDate = ParseSapDate(inv.DocDate),
                GrossDocTotal = lines.Sum(l => l.LineTotal),
                DiscountValue = inv.TotalDiscount,
                VatSum = inv.VatSum,
                Currency = inv.DocCurrency ?? "",
                DeliveryNotes = notes
            });
        }

        return result;
    }

    public async Task MarkInvoicesAsReportedAsync(IReadOnlyList<int> sapDocEntries, CancellationToken ct)
    {
        foreach (var entry in sapDocEntries)
        {
            var body = new Dictionary<string, string> { [ReportedField] = "Y" };
            using var resp = await _http.PatchAsJsonAsync($"Invoices({entry})", body, WriteJson, ct);
            if (!resp.IsSuccessStatusCode)
            {
                // Not marking means the invoice is re-sent next run — make that loud, not silent.
                var detail = await resp.Content.ReadAsStringAsync(ct);
                throw new InvalidOperationException(
                    $"Failed to set {ReportedField} on invoice {entry} ({(int)resp.StatusCode}): {detail}");
            }
        }
    }

    private async Task<string?> ResolveSupplierCodeAsync(string cardCode, Dictionary<string, SlBp?> cache, CancellationToken ct)
    {
        var bp = await GetBpAsync(cardCode, cache, ct);
        var own = Str(bp?.U_ESG_SupplierCode);
        if (!string.IsNullOrWhiteSpace(own) || string.IsNullOrWhiteSpace(bp?.FatherCard)) return own;
        var father = await GetBpAsync(bp!.FatherCard!, cache, ct);
        return Str(father?.U_ESG_SupplierCode);
    }

    private async Task<SlBp?> GetBpAsync(string cardCode, Dictionary<string, SlBp?> cache, CancellationToken ct)
    {
        if (cache.TryGetValue(cardCode, out var hit)) return hit;
        var bp = await GetSingleAsync<SlBp>(
            $"BusinessPartners('{cardCode.Replace("'", "''")}')?$select=CardCode,FatherCard,U_ESG_SupplierCode", ct);
        cache[cardCode] = bp;
        return bp;
    }

    private async Task<T?> GetSingleAsync<T>(string url, CancellationToken ct) where T : class
    {
        using var resp = await _http.GetAsync(url, ct);
        if (resp.StatusCode == System.Net.HttpStatusCode.NotFound) return null;
        if (!resp.IsSuccessStatusCode)
            throw new InvalidOperationException(
                $"Service Layer GET failed ({(int)resp.StatusCode}) {url}: {await resp.Content.ReadAsStringAsync(ct)}");
        return await resp.Content.ReadFromJsonAsync<T>(Json, ct);
    }

    /// <summary>Follows OData paging; a failed page is a fault, never a silently empty result.</summary>
    private async Task<List<T>> GetAllPagesAsync<T>(string url, CancellationToken ct)
    {
        var all = new List<T>();
        string? next = url;
        for (var page = 0; next is not null && page < 500; page++)
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, next);
            req.Headers.TryAddWithoutValidation("Prefer", "odata.maxpagesize=200");
            using var resp = await _http.SendAsync(req, ct);
            if (!resp.IsSuccessStatusCode)
                throw new InvalidOperationException(
                    $"Service Layer query failed ({(int)resp.StatusCode}) {next}: {await resp.Content.ReadAsStringAsync(ct)}");

            using var doc = await JsonDocument.ParseAsync(await resp.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
            if (doc.RootElement.TryGetProperty("value", out var arr))
                all.AddRange(arr.Deserialize<List<T>>(Json) ?? []);

            next = doc.RootElement.TryGetProperty("odata.nextLink", out var a) ? a.GetString()
                 : doc.RootElement.TryGetProperty("@odata.nextLink", out var b) ? b.GetString()
                 : null;
        }
        return all;
    }

    // UDFs may be alphanumeric or numeric in SAP; accept either without failing deserialization.
    private static string? Str(JsonElement? e) => e is null ? null : e.Value.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => null,
        JsonValueKind.String => e.Value.GetString(),
        _ => e.Value.GetRawText()
    };

    // Service Layer returns dates as full ISO datetimes (e.g. "2026-11-27T00:00:00Z"),
    // which DateOnly.Parse rejects. Parse as DateTime first, then take the date.
    private static DateOnly ParseSapDate(string raw) =>
        DateOnly.FromDateTime(DateTime.Parse(raw,
            System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.RoundtripKind));

    private sealed record ODataPage<T>(IReadOnlyList<T> Value);
    private sealed record DeliveryNoteDto(int DocEntry, int DocNum, string CardCode, string? DocumentStatus);
    private sealed record DocEntryDto(int DocEntry);
    private sealed record SlInvoice(int DocEntry, int DocNum, string DocDate, string CardCode, string? DocCurrency,
        decimal TotalDiscount, decimal VatSum, List<SlLine>? DocumentLines);
    private sealed record SlLine(int LineNum, string? ItemCode, decimal Quantity, decimal UnitPrice, decimal LineTotal,
        int? BaseType, int? BaseEntry, int? BaseLine, string? SupplierCatNum);
    private sealed record SlBp(string CardCode, string? FatherCard, JsonElement? U_ESG_SupplierCode);
    private sealed record SlDn(int DocEntry, int DocNum, string DocDate, string CardCode, string? NumAtCard,
        JsonElement? U_ESG_SupplyApproval);
}
