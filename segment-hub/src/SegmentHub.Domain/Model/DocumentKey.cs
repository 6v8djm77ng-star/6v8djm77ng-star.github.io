namespace SegmentHub.Domain.Model;

/// <summary>
/// A normalized reference to a SAP document (delivery note / invoice / order) as it appears
/// in a Segment file. The <see cref="Raw"/> value is kept verbatim for audit; <see cref="Normalized"/>
/// is what we match on.
///
/// ROOT-CAUSE NOTE: the 13.11 incident and ~1,582 historical SupplyApprovals failures were caused by
/// a reference like "2003837." (trailing dot / stray whitespace) not matching SAP's integer DocNum.
/// EasySale compared raw strings and failed silently. Here the match key is normalized once, centrally,
/// and the raw form is preserved so we can always explain a rejection.
/// </summary>
public readonly record struct DocumentKey
{
    public string Raw { get; }
    public string Normalized { get; }

    private DocumentKey(string raw, string normalized)
    {
        Raw = raw;
        Normalized = normalized;
    }

    /// <summary>True when the reference reduces to a usable numeric document number.</summary>
    public bool IsNumeric => Normalized is { Length: > 0 } n && n.All(char.IsDigit);

    // Formatting noise EasySale/Segment leave on an otherwise-numeric reference.
    // Removed anywhere in the string. Letters and other characters are deliberately NOT
    // removed: a reference that still holds non-digits after this is genuinely malformed
    // and must stay non-numeric so it is rejected, never coerced to a wrong DocNum.
    private static bool IsNoise(char c) =>
        char.IsWhiteSpace(c) || c == '﻿' || c == ',' || c == '.';

    public static DocumentKey From(string? raw)
    {
        raw ??= string.Empty;
        var cleaned = new string(raw.Where(c => !IsNoise(c)).ToArray());

        // Not a usable numeric ref (empty, or still contains letters/dashes) -> keep as-is,
        // IsNumeric stays false, and the validator rejects it with an explicit reason.
        if (cleaned.Length == 0 || !cleaned.All(char.IsDigit))
            return new DocumentKey(raw, cleaned);

        // Drop leading zeros so "0139" and "139" match, but never collapse to empty.
        var trimmed = cleaned.TrimStart('0');
        var normalized = trimmed.Length == 0 ? cleaned : trimmed;
        return new DocumentKey(raw, normalized);
    }

    public override string ToString() => IsNumeric ? Normalized : $"<non-numeric:'{Raw}'>";
}
