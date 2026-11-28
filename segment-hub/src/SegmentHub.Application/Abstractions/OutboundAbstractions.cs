using SegmentHub.Domain.Enums;
using SegmentHub.Domain.Model;

namespace SegmentHub.Application.Abstractions;

/// <summary>
/// An outbound Segment interface (OIG -> Segment). Generates files from SAP data and publishes them.
/// Symmetric to <see cref="ISegmentModule"/> but direction is reversed: we produce, not consume.
/// </summary>
public interface IOutboundModule
{
    string Key { get; }
    InterfaceDirection Direction => InterfaceDirection.Outbound;

    /// <summary>Generate and publish the outbound file. Returns an auditable result.</summary>
    Task<ProcessingResult> GenerateOutboundAsync(bool shadowMode, CancellationToken ct);
}

/// <summary>Publishes an outbound file to its target (folder, FTP, SFTP).</summary>
public interface IFilePublisher
{
    Task PublishAsync(string moduleKey, string fileName, byte[] content, CancellationToken ct);

    /// <summary>
    /// Shadow mode: write the generated file to a local folder outside EasySale's tree so it can be
    /// compared with the file EasySale produced. Never reaches Segment.
    /// </summary>
    Task WriteShadowCopyAsync(string moduleKey, string fileName, byte[] content, CancellationToken ct);
}
