-- SegmentHub: Audit log table
-- Target: SERVER2025 / SAP_OIG
-- READ-WRITE: This table is written by the Hub service only.
-- Run once before first deployment.

IF OBJECT_ID('dbo.HubProcessingLog', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.HubProcessingLog
    (
        Id              BIGINT          IDENTITY(1,1) NOT NULL,
        Module          NVARCHAR(50)    NOT NULL,
        FileName        NVARCHAR(500)   NOT NULL,
        Status          NVARCHAR(20)    NOT NULL,   -- Succeeded / Rejected / Faulted
        RejectCode      INT             NULL,
        RejectMessage   NVARCHAR(2000)  NULL,
        SapDocType      NVARCHAR(50)    NULL,       -- e.g. Invoice, SalesOrder, DeliveryNote
        SapDocEntry     INT             NULL,
        Fault           NVARCHAR(MAX)   NULL,
        ShadowMode      BIT             NOT NULL DEFAULT 0,
        CreatedUtc      DATETIME2(3)    NOT NULL DEFAULT SYSUTCDATETIME(),

        CONSTRAINT PK_HubProcessingLog PRIMARY KEY CLUSTERED (Id)
    );

    CREATE NONCLUSTERED INDEX IX_HubProcessingLog_Module_Created
        ON dbo.HubProcessingLog (Module, CreatedUtc DESC);

    CREATE NONCLUSTERED INDEX IX_HubProcessingLog_Status_Created
        ON dbo.HubProcessingLog (Status, CreatedUtc DESC)
        INCLUDE (Module, FileName);

    CREATE NONCLUSTERED INDEX IX_HubProcessingLog_SapDocEntry
        ON dbo.HubProcessingLog (SapDocEntry)
        WHERE SapDocEntry IS NOT NULL;

    PRINT 'Created dbo.HubProcessingLog with indexes.';
END
ELSE
    PRINT 'dbo.HubProcessingLog already exists — skipping.';
GO
