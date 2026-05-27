import { Phase6BridgeService, Phase6BridgeConfig } from './phase6-bridge-service';
import { ethers } from 'ethers';

// Minimal stub config — only the fields the probes touch
function makeConfig(overrides: Partial<Phase6BridgeConfig> = {}): Phase6BridgeConfig {
  return {
    ethereumProvider: {} as ethers.JsonRpcProvider,
    htlcBridgeContract: {} as ethers.Contract,
    escrowFactoryContract: {} as ethers.Contract,
    testTokenContract: {} as ethers.Contract,
    monitoringInterval: 60_000,
    maxRetries: 3,
    retryDelay: 1_000,
    minSafetyDeposit: '0',
    maxSafetyDeposit: '1000000000000000000',
    defaultTimelock: 86_400,
    bridgeFeeRate: 50,
    gasPriceMultiplier: 1,
    ...overrides,
  } as Phase6BridgeConfig;
}

describe('Phase6BridgeService RPC health probes', () => {
  let service: Phase6BridgeService;

  beforeEach(() => {
    service = new Phase6BridgeService(makeConfig());
  });

  test('getHealthStatus returns true for both connections when probes succeed', async () => {
    jest.spyOn(service, 'checkEthereumConnection').mockResolvedValue(true);
    jest.spyOn(service, 'checkStellarConnection').mockResolvedValue(true);

    const status = await service.getHealthStatus();

    expect(status.ethereumConnection).toBe(true);
    expect(status.stellarConnection).toBe(true);
    // isRunning is false (service not started), so isHealthy is false — that's correct
    expect(status).toMatchObject({ activeOrders: 0, errorRate: 0 });
  });

  test('getHealthStatus returns false for stellarConnection and isHealthy when Stellar RPC is down', async () => {
    jest.spyOn(service, 'checkEthereumConnection').mockResolvedValue(true);
    jest.spyOn(service, 'checkStellarConnection').mockResolvedValue(false);

    const status = await service.getHealthStatus();

    expect(status.ethereumConnection).toBe(true);
    expect(status.stellarConnection).toBe(false);
    expect(status.isHealthy).toBe(false);
  });

  test('getHealthStatus returns false for ethereumConnection and isHealthy when Ethereum RPC is down', async () => {
    jest.spyOn(service, 'checkEthereumConnection').mockResolvedValue(false);
    jest.spyOn(service, 'checkStellarConnection').mockResolvedValue(true);

    const status = await service.getHealthStatus();

    expect(status.ethereumConnection).toBe(false);
    expect(status.stellarConnection).toBe(true);
    expect(status.isHealthy).toBe(false);
  });

  test('checkEthereumConnection returns false when provider rejects (simulates timeout/error)', async () => {
    const provider = {
      getBlockNumber: () => Promise.reject(new Error('connection timeout')),
    } as unknown as ethers.JsonRpcProvider;

    const svc = new Phase6BridgeService(makeConfig({ ethereumProvider: provider }));
    const result = await svc.checkEthereumConnection();

    expect(result).toBe(false);
  });

  test('checkStellarConnection returns false on HTTP 5xx', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 }) as jest.Mock;

    const result = await service.checkStellarConnection();

    expect(result).toBe(false);
  });

  test('checkStellarConnection returns true on HTTP 200', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as jest.Mock;

    const result = await service.checkStellarConnection();

    expect(result).toBe(true);
  });
});
