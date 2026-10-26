import { expect } from 'chai';
import { OrderService } from '../src/services/order-service';
import { ConfigService } from '../src/services/config-service';

describe('OrderService Legacy Bridge Rejection', () => {
  let orderService: OrderService;
  let mockConfig: ConfigService;

  beforeEach(() => {
    mockConfig = {
      getActiveV2Escrow: () => '0x' + '1'.repeat(40)
    } as any;
    orderService = new OrderService(mockConfig);
  });

  it('should reject legacy bridge requests when v2 escrow is active', async () => {
    const request = {
      lockHash: '0x' + 'a'.repeat(64),
      target: '0x' + '0'.repeat(40),
      amount: 1000000000000000000n,
      expiration: 1000
    };

    try {
      await orderService.buildLockOrder(request);
      expect.fail('Should have thrown error');
    } catch (error: any) {
      expect(error.message).to.equal('Legacy bridge lock rejected: v2 escrow active');
    }
  });

  it('should allow v2 escrow requests', async () => {
    const v2EscrowAddress = '0x' + '1'.repeat(40);
    mockConfig.getActiveV2Escrow = () => v2EscrowAddress;

    const request = {
      lockHash: '0x' + 'a'.repeat(64),
      target: v2EscrowAddress,
      amount: 1000000000000000000n,
      expiration: 1000
    };

    const result = await orderService.buildLockOrder(request);
    expect(result.type).to.equal('v2_escrow_lock');
  });
});
