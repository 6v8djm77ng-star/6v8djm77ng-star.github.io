using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Http.Resilience;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Polly;
using SegmentHub.Application.Abstractions;
using SegmentHub.Infrastructure.Alerting;
using SegmentHub.Infrastructure.Configuration;
using SegmentHub.Infrastructure.Files;
using SegmentHub.Infrastructure.Persistence;
using SegmentHub.Infrastructure.Sap;

namespace SegmentHub.Infrastructure;

/// <summary>Registers infrastructure services. Composition root stays in the Worker.</summary>
public static class DependencyInjection
{
    public static IServiceCollection AddSegmentHubInfrastructure(this IServiceCollection services, IConfiguration config)
    {
        // Needed so Encoding.GetEncoding(1255) works on .NET for inbound Orders.
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

        services.AddOptions<HubOptions>().Bind(config.GetSection(HubOptions.SectionName));

        services.AddSingleton<IFileDecoder, FileDecoder>();
        services.AddSingleton<IFileQueue, FileSystemQueue>();
        services.AddSingleton<IFilePublisher, OutboundFilePublisher>();
        services.AddSingleton<IShadowComparer, LoggingShadowComparer>();

        // Audit store needs the SAP company connection string (integrated security in prod).
        services.AddSingleton<IProcessingAuditStore>(sp =>
            new SqlProcessingAuditStore(
                config.GetConnectionString("SapCompany")
                    ?? throw new InvalidOperationException("Missing ConnectionStrings:SapCompany"),
                sp.GetRequiredService<ILogger<SqlProcessingAuditStore>>()));

        // Teams webhook URL is read from config/secret; empty => alert sink no-ops.
        services.AddHttpClient("teams");
        services.AddSingleton<IAlertSink>(sp => new TeamsAlertSink(
            sp.GetRequiredService<IHttpClientFactory>().CreateClient("teams"),
            config["Alerting:TeamsWebhookUrl"],
            sp.GetRequiredService<ILogger<TeamsAlertSink>>()));

        // SAP Service Layer client with auto-login handler.
        services.AddTransient<ServiceLayerLoginHandler>();
        services.AddHttpClient<ISapGateway, ServiceLayerSapGateway>((sp, http) =>
        {
            var o = sp.GetRequiredService<IOptions<HubOptions>>().Value.ServiceLayer;
            http.BaseAddress = new Uri(o.BaseUrl.TrimEnd('/') + "/");
            http.Timeout = TimeSpan.FromSeconds(o.TimeoutSeconds);
        }).ConfigurePrimaryHttpMessageHandler(sp =>
        {
            var o = sp.GetRequiredService<IOptions<HubOptions>>().Value.ServiceLayer;
            var handler = new HttpClientHandler { UseCookies = false };
            // SAP SL uses a self-signed cert; accept it only when explicitly configured.
            if (!o.SslRejectUnauthorized)
                handler.ServerCertificateCustomValidationCallback =
                    HttpClientHandler.DangerousAcceptAnyServerCertificateValidator;
            return handler;
        }).AddHttpMessageHandler<ServiceLayerLoginHandler>()
          .AddResilienceHandler("sap-resilience", (builder, context) =>
          {
              builder
                  .AddRetry(new HttpRetryStrategyOptions
                  {
                      MaxRetryAttempts = 3,
                      Delay = TimeSpan.FromSeconds(1),
                      BackoffType = DelayBackoffType.Exponential,
                      ShouldHandle = args => ValueTask.FromResult(
                          args.Outcome.Result?.StatusCode is
                              System.Net.HttpStatusCode.RequestTimeout or
                              System.Net.HttpStatusCode.TooManyRequests or
                              System.Net.HttpStatusCode.ServiceUnavailable or
                              System.Net.HttpStatusCode.BadGateway or
                              System.Net.HttpStatusCode.GatewayTimeout
                          || args.Outcome.Exception is HttpRequestException or TimeoutException)
                  })
                  .AddCircuitBreaker(new HttpCircuitBreakerStrategyOptions
                  {
                      SamplingDuration = TimeSpan.FromSeconds(30),
                      FailureRatio = 0.5,
                      MinimumThroughput = 5,
                      BreakDuration = TimeSpan.FromSeconds(15)
                  })
                  .AddTimeout(TimeSpan.FromSeconds(30));
          });

        return services;
    }
}
