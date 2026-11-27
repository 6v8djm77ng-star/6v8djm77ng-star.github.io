using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging;
using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Enums;
using SegmentHub.Domain.Model;

namespace SegmentHub.Infrastructure.Persistence;

/// <summary>
/// Writes every outcome to SQL so nothing is ever silently lost (the opposite of EasySale's "no _MSG").
/// Target table (created by migration): dbo.HubProcessingLog(Id, Module, FileName, Status, RejectCode,
/// RejectMessage, SapDocType, SapDocEntry, Fault, ShadowMode, CreatedUtc).
/// </summary>
public sealed class SqlProcessingAuditStore : IProcessingAuditStore
{
    private readonly string _connectionString;
    private readonly ILogger<SqlProcessingAuditStore> _log;
    private int _failureCount;

    public SqlProcessingAuditStore(string connectionString, ILogger<SqlProcessingAuditStore> log)
    {
        _connectionString = connectionString;
        _log = log;
    }

    public async Task RecordAsync(ProcessingResult r, CancellationToken ct)
    {
        const string sql = """
            INSERT INTO dbo.HubProcessingLog
                (Module, FileName, Status, RejectCode, RejectMessage, SapDocType, SapDocEntry, Fault, ShadowMode, CreatedUtc)
            VALUES
                (@Module, @FileName, @Status, @RejectCode, @RejectMessage, @SapDocType, @SapDocEntry, @Fault, @ShadowMode, SYSUTCDATETIME());
            """;
        try
        {
            await using var cn = new SqlConnection(_connectionString);
            await cn.OpenAsync(ct);
            await using var cmd = new SqlCommand(sql, cn);
            cmd.Parameters.AddWithValue("@Module", r.ModuleKey);
            cmd.Parameters.AddWithValue("@FileName", r.SourceFileName);
            cmd.Parameters.AddWithValue("@Status", r.Status.ToString());
            cmd.Parameters.AddWithValue("@RejectCode", (object?)(int?)r.Rejection?.Code ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@RejectMessage", (object?)r.Rejection?.Message ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@SapDocType", (object?)r.CreatedSapDocType ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@SapDocEntry", (object?)r.CreatedSapDocEntry ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@Fault", (object?)r.FaultDetail ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@ShadowMode", r.ShadowMode);
            await cmd.ExecuteNonQueryAsync(ct);
        }
        catch (Exception ex)
        {
            // Audit must never take the pipeline down. The SQL store is a secondary, structured
            // copy — every decision is already in the Serilog log file — so a DB outage is a
            // concise one-time warning, not a per-file stack trace.
            var n = Interlocked.Increment(ref _failureCount);
            if (n == 1)
                _log.LogWarning(
                    "SQL audit write failed ({Error}). Processing continues and every decision stays in the Serilog log file. Further audit-DB failures will be counted, not stack-traced.",
                    ex.Message);
            else
                _log.LogDebug("SQL audit write failed again (#{Count}) for {File}: {Error}",
                    n, r.SourceFileName, ex.Message);
        }
    }
}
