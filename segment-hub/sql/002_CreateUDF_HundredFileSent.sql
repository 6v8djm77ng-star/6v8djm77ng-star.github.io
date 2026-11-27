-- SegmentHub: UDF on OINV for HundredFile (קובץ 100) tracking
-- Target: SERVER2025 / SAP_OIG
--
-- PREFERRED METHOD: Use SAP Service Layer REST API:
--   POST https://SERVER2025:50000/b1s/v1/UserFieldsMD
--   Body:
--   {
--     "TableName": "OINV",
--     "Name": "HundredFileSent",
--     "Description": "קובץ 100 נשלח",
--     "Type": "db_Alpha",
--     "SubType": "st_None",
--     "Size": 1,
--     "DefaultValue": "N"
--   }
--
-- FALLBACK: Direct SQL (use only if Service Layer approach fails).
-- SAP UDFs live in CUFD (field definition) + column on target table.
-- After running this, verify via SAP GUI: Tools > Customization Tools > User-Defined Fields.

-- Check if the UDF already exists
IF NOT EXISTS (
    SELECT 1 FROM CUFD
    WHERE TableID = 'OINV' AND AliasID = 'HundredFileSent'
)
BEGIN
    -- This INSERT registers the UDF metadata. SAP will auto-create the U_HundredFileSent column on OINV.
    DECLARE @fieldId INT;
    SELECT @fieldId = ISNULL(MAX(FieldID), -1) + 1 FROM CUFD WHERE TableID = 'OINV';

    INSERT INTO CUFD (TableID, FieldID, AliasID, Descr, TypeID, SizeID, EditType, Dflt)
    VALUES ('OINV', @fieldId, 'HundredFileSent', N'קובץ 100 נשלח', 'A', 1, 0, 'N');

    PRINT 'Created UDF U_HundredFileSent on OINV.';
    PRINT 'IMPORTANT: Verify in SAP GUI and restart SAP service if needed.';
END
ELSE
    PRINT 'UDF U_HundredFileSent already exists on OINV — skipping.';
GO
