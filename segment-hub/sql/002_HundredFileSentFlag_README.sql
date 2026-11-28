-- SegmentHub: קובץ 100 "sent" flag — NO MIGRATION NEEDED.
--
-- SegmentHub uses the field EasySale already maintains on OINV: U_ESG_100FileCreated
-- (found in the decompiled ESG_SegmentFiles_API: "Failed to update userfield: 'U_ESG_100FileCreated'").
-- Reusing it means no schema change and a seamless hand-over at cutover.
--
-- READ-ONLY check to confirm the field exists and see the values EasySale writes
-- (SegmentHub assumes 'Y' = sent; confirm before going live):
SELECT TOP 20 DocNum, DocDate, U_ESG_100FileCreated
FROM OINV
ORDER BY DocEntry DESC;
