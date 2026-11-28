using Microsoft.Data.SqlClient;
using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Model;

namespace SegmentHub.Infrastructure.HomeDelivery;

/// <summary>
/// READ-ONLY. Open Segment delivery notes with the facts the eligibility rules need, in one query.
/// Open lines (DLN1.LineStatus) and the direct-order-invoicing guard, as in the OIG auto-invoice app.
/// Parameterized; uses a read-intent connection. Never writes.
/// </summary>
public sealed class SqlHomeDeliveryReadModel : IHomeDeliveryReadModel
{
    private readonly string _connectionString;

    public SqlHomeDeliveryReadModel(string connectionString) => _connectionString = connectionString;

    public async Task<IReadOnlyList<HomeDeliveryCandidate>> GetCandidatesAsync(
        DateOnly from, IReadOnlyCollection<string> fatherCards, CancellationToken ct)
    {
        if (fatherCards.Count == 0) return [];

        var names = fatherCards.Select((_, i) => $"@f{i}").ToArray();
        var inList = string.Join(",", names);
        var sql = $"""
            SELECT H.DocEntry, H.DocNum, H.DocDate, H.CardCode, C.FatherCard, CAST(H.Comments AS nvarchar(4000)) AS Comments,
              H.NumAtCard,
              CASE WHEN EXISTS (SELECT 1 FROM ATC1 g WHERE g.AbsEntry = H.AtcEntry) THEN 1 ELSE 0 END AS HasPodAttachment,
              (SELECT COUNT(*) FROM DLN1 L WHERE L.DocEntry = H.DocEntry AND L.LineStatus = 'O') AS OpenLinesCount,
              CASE WHEN EXISTS (SELECT 1 FROM DLN1 L
                                JOIN INV1 I ON I.BaseType = 17 AND I.BaseEntry = L.BaseEntry
                                JOIN OINV IH ON IH.DocEntry = I.DocEntry AND IH.CANCELED = 'N'
                                WHERE L.DocEntry = H.DocEntry AND L.BaseType = 17)
                   THEN 1 ELSE 0 END AS SourceOrderInvoicedDirectly
            FROM ODLN H
            JOIN OCRD C ON C.CardCode = H.CardCode
            WHERE H.DocStatus = 'O' AND H.CANCELED = 'N' AND H.DocDate >= @from
              AND (C.FatherCard IN ({inList}) OR H.CardCode IN ({inList}))
            ORDER BY H.DocEntry
            """;

        await using var cn = new SqlConnection(_connectionString);
        await cn.OpenAsync(ct);
        await using var cmd = new SqlCommand(sql, cn) { CommandTimeout = 60 };
        cmd.Parameters.Add(new SqlParameter("@from", System.Data.SqlDbType.Date) { Value = from.ToDateTime(TimeOnly.MinValue) });
        var i = 0;
        foreach (var fc in fatherCards)
            cmd.Parameters.Add(new SqlParameter(names[i++], System.Data.SqlDbType.NVarChar, 15) { Value = fc });

        var list = new List<HomeDeliveryCandidate>();
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
        {
            list.Add(new HomeDeliveryCandidate
            {
                DnDocEntry = r.GetInt32(0),
                DnDocNum = r.GetInt32(1),
                DnDate = DateOnly.FromDateTime(r.GetDateTime(2)),
                CardCode = r.GetString(3),
                FatherCard = r.IsDBNull(4) ? null : r.GetString(4),
                Comments = r.IsDBNull(5) ? null : r.GetString(5),
                NumAtCard = r.IsDBNull(6) ? null : r.GetString(6),
                HasPodAttachment = r.GetInt32(7) == 1,
                OpenLinesCount = r.GetInt32(8),
                SourceOrderInvoicedDirectly = r.GetInt32(9) == 1
            });
        }
        return list;
    }
}
