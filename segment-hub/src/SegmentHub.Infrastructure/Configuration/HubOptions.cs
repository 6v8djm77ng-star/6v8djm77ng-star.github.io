namespace SegmentHub.Infrastructure.Configuration;

/// <summary>Root options, bound from appsettings.json. Config-driven so format/path changes need no code.</summary>
public sealed class HubOptions
{
    public const string SectionName = "Hub";

    /// <summary>Global kill-switch. When true, NOTHING is written to SAP — every module runs read-only.</summary>
    public bool ShadowMode { get; set; } = true;

    public ServiceLayerOptions ServiceLayer { get; set; } = new();
    public QueueOptions Queue { get; set; } = new();

    /// <summary>Per-interface settings keyed by module key ("SupplyApprovals", "Orders", ...).</summary>
    public Dictionary<string, InterfaceOptions> Interfaces { get; set; } = new();

    /// <summary>Branch code -> Electra father card. From @ESG_CONF on 220.</summary>
    public Dictionary<string, string> FatherCardByBranch { get; set; } = new();

    public string DefaultFatherCard { get; set; } = "2005000";
}

public sealed class ServiceLayerOptions
{
    public string BaseUrl { get; set; } = "https://SERVER2025:50000/b1s/v1";
    public string CompanyDb { get; set; } = "SAP_OIG";
    public string UserName { get; set; } = "";
    public string Password { get; set; } = ""; // from user-secrets / env, never appsettings
    public int TimeoutSeconds { get; set; } = 30;

    /// <summary>
    /// SAP SL ships a self-signed certificate. When false, accept it (matches the existing
    /// integrations' SAP_SL_SSL_REJECT_UNAUTHORIZED=false posture). Keep true wherever a
    /// trusted cert is installed. Scoped to the SL HttpClient only.
    /// </summary>
    public bool SslRejectUnauthorized { get; set; } = true;
}

public sealed class QueueOptions
{
    /// <summary>Root of the EasySale-compatible folder tree while we run side by side.</summary>
    public string RootPath { get; set; } = @"C:\ES_SAP\ES_SegmentFile\ESG_SegmentFiles_API\Documents";
    public int MaxBatch { get; set; } = 50;
}

public sealed class InterfaceOptions
{
    public bool Enabled { get; set; } = true;
    /// <summary>Overrides the global ShadowMode per interface so we can flip one at a time at cutover.</summary>
    public bool? ShadowMode { get; set; }
    public string Encoding { get; set; } = "utf-8";
    public int PollSeconds { get; set; } = 60;
    public string InboundFolder { get; set; } = "";
    /// <summary>Hour of day (0-23) for outbound modules. Default 16 (4 PM).</summary>
    public int OutboundRunHour { get; set; }
}
