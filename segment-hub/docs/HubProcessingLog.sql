-- Audit table for the Segment Integration Hub. Every processing outcome lands here.
-- Run once in SAP_OIG (or a side DB). READ-ONLY note: this CREATE is the only DDL the hub needs;
-- the hub itself only INSERTs. Review before running in production.
IF OBJECT_ID('dbo.HubProcessingLog', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.HubProcessingLog
    (
        Id            BIGINT IDENTITY(1,1) PRIMARY KEY,
        Module        NVARCHAR(64)   NOT NULL,
        FileName      NVARCHAR(260)  NOT NULL,
        Status        NVARCHAR(20)   NOT NULL,   -- Succeeded | Rejected | Faulted
        RejectCode    INT            NULL,
        RejectMessage NVARCHAR(1000) NULL,
        SapDocType    NVARCHAR(40)   NULL,
        SapDocEntry   INT            NULL,
        Fault         NVARCHAR(2000) NULL,
        ShadowMode    BIT            NOT NULL,
        CreatedUtc    DATETIME2(3)   NOT NULL
    );

    CREATE INDEX IX_HubProcessingLog_Module_Created ON dbo.HubProcessingLog (Module, CreatedUtc DESC);
    CREATE INDEX IX_HubProcessingLog_Status         ON dbo.HubProcessingLog (Status) WHERE Status <> 'Succeeded';
END
