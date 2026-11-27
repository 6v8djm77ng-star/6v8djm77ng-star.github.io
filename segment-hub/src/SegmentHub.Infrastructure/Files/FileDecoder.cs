using System.Text;
using SegmentHub.Application.Abstractions;

namespace SegmentHub.Infrastructure.Files;

/// <summary>
/// Decodes raw bytes with the encoding each interface declares. Observed on 220: inbound Orders are
/// Windows-1255, SupplyApprovals are UTF-8, outbound DeliveryNotes are UTF-8-BOM. Register the code-pages
/// provider once (done in DI) so 1255 is available on .NET.
/// </summary>
public sealed class FileDecoder : IFileDecoder
{
    public string Decode(byte[] content, string encodingName)
    {
        var enc = encodingName.ToLowerInvariant() switch
        {
            "utf-8" or "utf8" => new UTF8Encoding(encoderShouldEmitUTF8Identifier: false),
            "windows-1255" or "1255" => Encoding.GetEncoding(1255),
            _ => Encoding.GetEncoding(encodingName)
        };
        var text = enc.GetString(content);
        return text.TrimStart('﻿'); // drop BOM if present
    }
}
