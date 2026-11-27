namespace SegmentHub.Domain.Enums;

/// <summary>Direction of a Segment interface relative to OIG/SAP.</summary>
public enum InterfaceDirection
{
    /// <summary>Segment -> OIG (we consume a file and create a document in SAP).</summary>
    Inbound,
    /// <summary>OIG -> Segment (we produce a file from SAP and push it).</summary>
    Outbound
}

/// <summary>Final status of processing one Segment record/file.</summary>
public enum ProcessingStatus
{
    /// <summary>Successfully created/updated the SAP document (or, in shadow mode, would have).</summary>
    Succeeded,
    /// <summary>Deliberately rejected with a known business reason. NOT an error — expected and logged.</summary>
    Rejected,
    /// <summary>Unexpected failure (bug, infra, SAP down). Retryable.</summary>
    Faulted
}

/// <summary>
/// Stable rejection codes. Every rejection carries one — this is the cure for EasySale's
/// silent "no _MSG" failures. A code is never thrown away; it is logged and surfaced.
/// </summary>
public enum RejectionCode
{
    None = 0,
    MalformedFile = 1,
    WrongColumnCount = 2,
    UnknownSupplier = 3,
    LinkedDeliveryNoteNotFound = 10,   // the chronic EasySale failure (INV1.BaseEntry)
    DeliveryNoteAlreadyInvoiced = 11,
    ItemNotFoundInSap = 20,
    InvalidBusinessPartner = 21,
    QuantityMismatch = 30,
    PriceMismatch = 31,
    DuplicateDocument = 40,
    OrderAlreadyExists = 50,
    InvalidDeliveryDate = 51,
    BranchNotConfigured = 52,
    EmptyOrder = 55,
    HundredFileGenerationFailed = 60,
    DeliveryNoteStatusMismatch = 70
}

/// <summary>סוג הזמנה: סניף או בית לקוח. נקבע לפי שדות הכתובת/טלפון בשורות ההזמנה.</summary>
public enum OrderType { Branch, HomeDelivery }

/// <summary>פעולה על תעודת משלוח מדווחת בממשק 9.</summary>
public enum DeliveryNoteAction
{
    Unknown = 0,
    Delivered = 1,
    Returned = 2,
    PartialDelivery = 3
}
