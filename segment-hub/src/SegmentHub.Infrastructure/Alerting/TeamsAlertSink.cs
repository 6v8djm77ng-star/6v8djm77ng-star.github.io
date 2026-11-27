using System.Net.Http.Json;
using Microsoft.Extensions.Logging;
using SegmentHub.Application.Abstractions;

namespace SegmentHub.Infrastructure.Alerting;

/// <summary>
/// Posts an Adaptive Card to the same Teams Workflows webhook used by EasySaleWatch.
/// Only for things a human must act on (faults, a stuck queue) — never for ordinary rejections.
/// A null/empty webhook makes this a no-op, so the hub runs fine before the URL is configured.
/// </summary>
public sealed class TeamsAlertSink : IAlertSink
{
    private readonly HttpClient _http;
    private readonly string? _webhookUrl;
    private readonly ILogger<TeamsAlertSink> _log;

    public TeamsAlertSink(HttpClient http, string? webhookUrl, ILogger<TeamsAlertSink> log)
    {
        _http = http;
        _webhookUrl = webhookUrl;
        _log = log;
    }

    public async Task RaiseAsync(string title, string body, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(_webhookUrl))
        {
            _log.LogWarning("Alert (no Teams webhook configured): {Title} - {Body}", title, body);
            return;
        }

        var card = new
        {
            type = "message",
            attachments = new[]
            {
                new
                {
                    contentType = "application/vnd.microsoft.card.adaptive",
                    content = new
                    {
                        schema = "http://adaptivecards.io/schemas/adaptive-card.json",
                        type = "AdaptiveCard",
                        version = "1.4",
                        body = new object[]
                        {
                            new { type = "TextBlock", text = title, weight = "Bolder", wrap = true },
                            new { type = "TextBlock", text = body, wrap = true }
                        }
                    }
                }
            }
        };

        try
        {
            using var resp = await _http.PostAsJsonAsync(_webhookUrl, card, ct);
            if (!resp.IsSuccessStatusCode)
                _log.LogWarning("Teams webhook returned {Status}", resp.StatusCode);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Teams alert failed");
        }
    }
}
