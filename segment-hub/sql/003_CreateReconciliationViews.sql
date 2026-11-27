-- SegmentHub: Reconciliation & monitoring views
-- Target: SERVER2025 / SAP_OIG
-- ALL VIEWS ARE READ-ONLY. No data is modified.

-- v_HubProcessingStats: daily processing counts by module + status (last 30 days)
IF OBJECT_ID('dbo.v_HubProcessingStats', 'V') IS NOT NULL DROP VIEW dbo.v_HubProcessingStats;
GO
CREATE VIEW dbo.v_HubProcessingStats AS
    SELECT
        CAST(CreatedUtc AS DATE)    AS ProcessDate,
        Module,
        Status,
        COUNT(*)                    AS RecordCount,
        COUNT(CASE WHEN ShadowMode = 1 THEN 1 END) AS ShadowCount
    FROM dbo.HubProcessingLog
    WHERE CreatedUtc >= DATEADD(DAY, -30, SYSUTCDATETIME())
    GROUP BY CAST(CreatedUtc AS DATE), Module, Status;
GO

-- v_HubOpenDeliveryNotes: open SAP delivery notes not yet settled by Hub
IF OBJECT_ID('dbo.v_HubOpenDeliveryNotes', 'V') IS NOT NULL DROP VIEW dbo.v_HubOpenDeliveryNotes;
GO
CREATE VIEW dbo.v_HubOpenDeliveryNotes AS
    SELECT
        d.DocEntry,
        d.DocNum,
        d.CardCode,
        d.CardName,
        d.DocDate,
        d.DocTotal,
        d.DocDueDate,
        CASE WHEN h.Id IS NOT NULL THEN 'Processed' ELSE 'Pending' END AS HubStatus
    FROM ODLN d
    LEFT JOIN dbo.HubProcessingLog h
        ON h.SapDocEntry = d.DocEntry
        AND h.Module = 'DeliveryNotes'
        AND h.Status = 'Succeeded'
    WHERE d.DocStatus = 'O';  -- Open
GO

-- v_HubPendingHundredFile: invoices not yet sent in קובץ 100
IF OBJECT_ID('dbo.v_HubPendingHundredFile', 'V') IS NOT NULL DROP VIEW dbo.v_HubPendingHundredFile;
GO
CREATE VIEW dbo.v_HubPendingHundredFile AS
    SELECT
        i.DocEntry,
        i.DocNum,
        i.CardCode,
        i.CardName,
        i.DocDate,
        i.DocTotal,
        i.VatSum,
        i.DocTotal - i.VatSum AS NetAmount
    FROM OINV i
    WHERE ISNULL(i.U_HundredFileSent, 'N') <> 'Y'
      AND i.CANCELED = 'N';
GO

-- v_HubRecentFaults: last 100 faults with full detail
IF OBJECT_ID('dbo.v_HubRecentFaults', 'V') IS NOT NULL DROP VIEW dbo.v_HubRecentFaults;
GO
CREATE VIEW dbo.v_HubRecentFaults AS
    SELECT TOP 100
        Id,
        Module,
        FileName,
        Fault,
        ShadowMode,
        CreatedUtc
    FROM dbo.HubProcessingLog
    WHERE Status = 'Faulted'
    ORDER BY CreatedUtc DESC;
GO

PRINT 'Reconciliation views created.';
