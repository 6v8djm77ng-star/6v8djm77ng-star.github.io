using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using SegmentHub.Infrastructure.Configuration;

namespace SegmentHub.Infrastructure.Sap;

/// <summary>
/// DelegatingHandler that manages SAP Service Layer session (B1SESSION cookie).
/// On first request or after 401, POSTs to /Login. Thread-safe via SemaphoreSlim.
/// </summary>
public sealed class ServiceLayerLoginHandler : DelegatingHandler
{
    private readonly ServiceLayerOptions _opt;
    private readonly ILogger<ServiceLayerLoginHandler> _log;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private string? _sessionCookie;
    private string? _routeId;

    public ServiceLayerLoginHandler(IOptions<HubOptions> opt, ILogger<ServiceLayerLoginHandler> log)
    {
        _opt = opt.Value.ServiceLayer;
        _log = log;
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        await EnsureSessionAsync(ct);
        AttachCookies(request);

        var response = await base.SendAsync(request, ct);

        if (response.StatusCode == HttpStatusCode.Unauthorized)
        {
            _log.LogWarning("B1SESSION expired, re-authenticating");
            _sessionCookie = null;
            await EnsureSessionAsync(ct);
            AttachCookies(request);
            response = await base.SendAsync(request, ct);
        }

        return response;
    }

    private async Task EnsureSessionAsync(CancellationToken ct)
    {
        if (_sessionCookie is not null) return;

        await _gate.WaitAsync(ct);
        try
        {
            if (_sessionCookie is not null) return;

            var loginUrl = _opt.BaseUrl.TrimEnd('/') + "/Login";
            var body = JsonSerializer.Serialize(new
            {
                CompanyDB = _opt.CompanyDb,
                UserName = _opt.UserName,
                Password = _opt.Password
            });

            using var loginReq = new HttpRequestMessage(HttpMethod.Post, loginUrl)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json")
            };

            using var resp = await base.SendAsync(loginReq, ct);
            resp.EnsureSuccessStatusCode();

            if (resp.Headers.TryGetValues("Set-Cookie", out var cookies))
            {
                foreach (var c in cookies)
                {
                    if (c.StartsWith("B1SESSION=", StringComparison.OrdinalIgnoreCase))
                        _sessionCookie = ExtractValue(c);
                    else if (c.StartsWith("ROUTEID=", StringComparison.OrdinalIgnoreCase))
                        _routeId = ExtractValue(c);
                }
            }

            if (_sessionCookie is null)
                throw new InvalidOperationException("Service Layer login succeeded but no B1SESSION cookie returned");

            _log.LogInformation("Service Layer session established");
        }
        finally
        {
            _gate.Release();
        }
    }

    private void AttachCookies(HttpRequestMessage request)
    {
        if (_sessionCookie is null) return;
        var cookie = $"B1SESSION={_sessionCookie}";
        if (_routeId is not null) cookie += $"; ROUTEID={_routeId}";
        request.Headers.Remove("Cookie");
        request.Headers.TryAddWithoutValidation("Cookie", cookie);
    }

    private static string ExtractValue(string setCookie)
    {
        var eq = setCookie.IndexOf('=');
        var semi = setCookie.IndexOf(';', eq);
        return semi < 0 ? setCookie[(eq + 1)..] : setCookie[(eq + 1)..semi];
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _gate.Dispose();
        base.Dispose(disposing);
    }
}
