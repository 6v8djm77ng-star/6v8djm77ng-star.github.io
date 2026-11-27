using SegmentHub.Application.Abstractions;
using SegmentHub.Domain.Enums;
using SegmentHub.Domain.Model;
using SegmentHub.Modules.Orders.Rules;
using SegmentHub.Tests.Fakes;
using Xunit;

namespace SegmentHub.Tests.Orders;

public class OrderValidatorTests
{
    private readonly FakeSapGateway _sap = new();
    private readonly OrderValidator _sut;

    public OrderValidatorTests()
    {
        _sut = new OrderValidator(_sap, _ => "2005000");
    }

    private static ElectraOrder MakeOrder(
        string orderNumber = "10300001",
        string supplierCode = "600060078",
        string branchCode = "001",
        DateOnly? deliveryDate = null,
        int lineCount = 1)
    {
        var lines = Enumerable.Range(1, lineCount).Select(i => new ElectraOrderLine
        {
            ItemCode = $"ITEM{i:D5}",
            Description = $"Test item {i}",
            Quantity = 1,
            UnitPrice = 100m,
            Discount = 0,
            LineTotal = 100m,
            ColorCode = "",
            SizeCode = "",
            ModelCode = "",
            WarehouseCode = "01",
            OrderLineNumber = i,
            Remark = "",
            RawColumns = []
        }).ToList();

        return new ElectraOrder
        {
            SourceFileName = "test.txt",
            SupplierCode = supplierCode,
            BranchCode = branchCode,
            OrderNumber = orderNumber,
            OrderDate = DateOnly.FromDateTime(DateTime.Today),
            DeliveryDate = deliveryDate ?? DateOnly.FromDateTime(DateTime.Today.AddDays(7)),
            CustomerName = "",
            CustomerPhone = "",
            CustomerAddress = "",
            CustomerCity = "",
            DeliveryBranchCode = branchCode,
            Lines = lines
        };
    }

    [Fact]
    public async Task Valid_order_passes()
    {
        var result = await _sut.ValidateAsync(MakeOrder(), CancellationToken.None);
        Assert.Null(result);
    }

    [Fact]
    public async Task Empty_lines_rejects()
    {
        var order = MakeOrder(lineCount: 0);
        var result = await _sut.ValidateAsync(order, CancellationToken.None);
        Assert.NotNull(result);
        Assert.Equal(RejectionCode.EmptyOrder, result.Code);
    }

    [Fact]
    public async Task Wrong_supplier_rejects()
    {
        var order = MakeOrder(supplierCode: "999999999");
        var result = await _sut.ValidateAsync(order, CancellationToken.None);
        Assert.NotNull(result);
        Assert.Equal(RejectionCode.UnknownSupplier, result.Code);
    }

    [Fact]
    public async Task Past_delivery_date_rejects()
    {
        var order = MakeOrder(deliveryDate: DateOnly.FromDateTime(DateTime.Today.AddDays(-1)));
        var result = await _sut.ValidateAsync(order, CancellationToken.None);
        Assert.NotNull(result);
        Assert.Equal(RejectionCode.InvalidDeliveryDate, result.Code);
    }

    [Fact]
    public async Task Duplicate_order_rejects()
    {
        _sap.NextOrderExists = true;
        var result = await _sut.ValidateAsync(MakeOrder(), CancellationToken.None);
        Assert.NotNull(result);
        Assert.Equal(RejectionCode.DuplicateDocument, result.Code);
    }

    [Fact]
    public async Task Multiple_lines_valid()
    {
        var order = MakeOrder(lineCount: 5);
        var result = await _sut.ValidateAsync(order, CancellationToken.None);
        Assert.Null(result);
    }
}
