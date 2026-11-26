import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FreighterNetworkMismatchError, useFreighter } from './useFreighter';
import freighterApi from '@stellar/freighter-api';

vi.mock('@stellar/freighter-api', () => ({
  default: {
    isConnected: vi.fn(),
    getAddress: vi.fn(),
    setAllowed: vi.fn(),
    getNetwork: vi.fn(),
    signTransaction: vi.fn(),
  },
  isConnected: vi.fn(),
  getAddress: vi.fn(),
  setAllowed: vi.fn(),
  getNetwork: vi.fn(),
  signTransaction: vi.fn(),
}));

const TEST_STELLAR_ADDRESS = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ12345678901234567890123456789012';
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
const MAINNET_PASSPHRASE = 'Public Global Stellar Network ; September 2015';
const SAMPLE_UNSIGNED_XDR = 'AAAAAG1vY2stdW5zaWduZWQteGRyLXRyYW5zYWN0aW9u';
const SAMPLE_SIGNED_XDR = 'AAAAAG1vY2stc2lnbmVkLXhkci10cmFuc2FjdGlvbg==';

describe('useFreighter — Network Agreement & Refusal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/?network=testnet');

    vi.mocked(freighterApi.isConnected).mockResolvedValue(true);
    vi.mocked(freighterApi.getAddress).mockResolvedValue({ address: TEST_STELLAR_ADDRESS });
    vi.mocked(freighterApi.setAllowed).mockResolvedValue(undefined as any);
    vi.mocked(freighterApi.getNetwork).mockResolvedValue({
      network: 'TESTNET',
      networkPassphrase: TESTNET_PASSPHRASE,
    });
    vi.mocked(freighterApi.signTransaction).mockResolvedValue({
      signedTxXdr: SAMPLE_SIGNED_XDR,
    });
  });

  describe('Acceptance Criterion 1: A matching network can request a signature', () => {
    it('requests a signature when Freighter testnet matches order testnet mode', async () => {
      vi.mocked(freighterApi.getNetwork).mockResolvedValue({
        network: 'TESTNET',
        networkPassphrase: TESTNET_PASSPHRASE,
      });

      const { result } = renderHook(() => useFreighter({ networkMode: 'testnet' }));

      await waitFor(() => expect(result.current.isConnected).toBe(true));

      const signed = await result.current.signTransaction(
        SAMPLE_UNSIGNED_XDR,
        TESTNET_PASSPHRASE,
        TEST_STELLAR_ADDRESS,
      );

      expect(signed).toBe(SAMPLE_SIGNED_XDR);
      expect(freighterApi.signTransaction).toHaveBeenCalledTimes(1);
      expect(freighterApi.signTransaction).toHaveBeenCalledWith(SAMPLE_UNSIGNED_XDR, {
        networkPassphrase: TESTNET_PASSPHRASE,
        address: TEST_STELLAR_ADDRESS,
      });
    });

    it('requests a signature when Freighter mainnet matches order mainnet mode', async () => {
      vi.mocked(freighterApi.getNetwork).mockResolvedValue({
        network: 'PUBLIC',
        networkPassphrase: MAINNET_PASSPHRASE,
      });

      const { result } = renderHook(() => useFreighter({ networkMode: 'mainnet' }));

      await waitFor(() => expect(result.current.isConnected).toBe(true));

      const signed = await result.current.signTransaction(
        SAMPLE_UNSIGNED_XDR,
        MAINNET_PASSPHRASE,
        TEST_STELLAR_ADDRESS,
      );

      expect(signed).toBe(SAMPLE_SIGNED_XDR);
      expect(freighterApi.signTransaction).toHaveBeenCalledTimes(1);
      expect(freighterApi.signTransaction).toHaveBeenCalledWith(SAMPLE_UNSIGNED_XDR, {
        networkPassphrase: MAINNET_PASSPHRASE,
        address: TEST_STELLAR_ADDRESS,
      });
    });

    it('accepts string network mode input in useFreighter', async () => {
      vi.mocked(freighterApi.getNetwork).mockResolvedValue({
        network: 'TESTNET',
        networkPassphrase: TESTNET_PASSPHRASE,
      });

      const { result } = renderHook(() => useFreighter('testnet'));

      await waitFor(() => expect(result.current.isConnected).toBe(true));

      const signed = await result.current.signTransaction(
        SAMPLE_UNSIGNED_XDR,
        TESTNET_PASSPHRASE,
      );

      expect(signed).toBe(SAMPLE_SIGNED_XDR);
      expect(freighterApi.signTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('Acceptance Criterion 2: A mismatch does not call the sign method', () => {
    it('refuses signature when Freighter is on mainnet but order is on testnet', async () => {
      vi.mocked(freighterApi.getNetwork).mockResolvedValue({
        network: 'PUBLIC',
        networkPassphrase: MAINNET_PASSPHRASE,
      });

      const { result } = renderHook(() => useFreighter({ networkMode: 'testnet' }));

      await waitFor(() => expect(result.current.isConnected).toBe(true));

      await expect(
        result.current.signTransaction(
          SAMPLE_UNSIGNED_XDR,
          TESTNET_PASSPHRASE,
          TEST_STELLAR_ADDRESS,
        ),
      ).rejects.toThrow(FreighterNetworkMismatchError);

      expect(freighterApi.signTransaction).not.toHaveBeenCalled();
    });

    it('refuses signature when Freighter is on testnet but order is on mainnet', async () => {
      vi.mocked(freighterApi.getNetwork).mockResolvedValue({
        network: 'TESTNET',
        networkPassphrase: TESTNET_PASSPHRASE,
      });

      const { result } = renderHook(() => useFreighter({ networkMode: 'mainnet' }));

      await waitFor(() => expect(result.current.isConnected).toBe(true));

      await expect(
        result.current.signTransaction(
          SAMPLE_UNSIGNED_XDR,
          MAINNET_PASSPHRASE,
          TEST_STELLAR_ADDRESS,
        ),
      ).rejects.toThrow(FreighterNetworkMismatchError);

      expect(freighterApi.signTransaction).not.toHaveBeenCalled();
    });

    it('refuses signature when Freighter network cannot be determined (null)', async () => {
      vi.mocked(freighterApi.getNetwork).mockResolvedValue(null as any);

      const { result } = renderHook(() => useFreighter({ networkMode: 'testnet' }));

      await waitFor(() => expect(result.current.isConnected).toBe(true));

      await expect(
        result.current.signTransaction(
          SAMPLE_UNSIGNED_XDR,
          TESTNET_PASSPHRASE,
          TEST_STELLAR_ADDRESS,
        ),
      ).rejects.toThrow(FreighterNetworkMismatchError);

      expect(freighterApi.signTransaction).not.toHaveBeenCalled();
    });

    it('does not include the signed XDR or unsigned XDR in the refusal error', async () => {
      vi.mocked(freighterApi.getNetwork).mockResolvedValue({
        network: 'PUBLIC',
        networkPassphrase: MAINNET_PASSPHRASE,
      });

      const { result } = renderHook(() => useFreighter({ networkMode: 'testnet' }));

      await waitFor(() => expect(result.current.isConnected).toBe(true));

      const secretXdr = 'SUPER_SECRET_PAYLOAD_XDR_DATA_9876543210';

      try {
        await result.current.signTransaction(
          secretXdr,
          TESTNET_PASSPHRASE,
          TEST_STELLAR_ADDRESS,
        );
        expect.unreachable('Expected signTransaction to throw');
      } catch (err: any) {
        expect(err).toBeInstanceOf(FreighterNetworkMismatchError);
        expect(err.message).not.toContain(secretXdr);
        expect(err.message).not.toContain(SAMPLE_SIGNED_XDR);
        expect(err.actualPassphrase).toBe(MAINNET_PASSPHRASE);
        expect(err.expectedPassphrase).toBe(TESTNET_PASSPHRASE);
      }

      expect(freighterApi.signTransaction).not.toHaveBeenCalled();
    });
  });

  describe('Acceptance Criterion 3: A network change between click and sign does not call the sign method', () => {
    it('refuses signature when Freighter network diverges right before signing opens', async () => {
      // Step 1: Hook initializes and user clicks (initially on testnet)
      vi.mocked(freighterApi.getNetwork).mockResolvedValueOnce({
        network: 'TESTNET',
        networkPassphrase: TESTNET_PASSPHRASE,
      });

      const { result } = renderHook(() => useFreighter({ networkMode: 'testnet' }));
      await waitFor(() => expect(result.current.isConnected).toBe(true));

      // Step 2: Between click and sign, Freighter network changes to mainnet
      vi.mocked(freighterApi.getNetwork).mockResolvedValue({
        network: 'PUBLIC',
        networkPassphrase: MAINNET_PASSPHRASE,
      });

      // Step 3: Signature is requested
      await expect(
        result.current.signTransaction(
          SAMPLE_UNSIGNED_XDR,
          TESTNET_PASSPHRASE,
          TEST_STELLAR_ADDRESS,
        ),
      ).rejects.toThrow(FreighterNetworkMismatchError);

      expect(freighterApi.signTransaction).not.toHaveBeenCalled();
    });

    it('refuses signature after a networkChange window event fires between click and sign', async () => {
      // Step 1: Initially matching
      vi.mocked(freighterApi.getNetwork).mockResolvedValue({
        network: 'TESTNET',
        networkPassphrase: TESTNET_PASSPHRASE,
      });

      const { result } = renderHook(() => useFreighter({ networkMode: 'testnet' }));
      await waitFor(() => expect(result.current.isConnected).toBe(true));

      // Step 2: Wallet switches network and window event fires
      vi.mocked(freighterApi.getNetwork).mockResolvedValue({
        network: 'PUBLIC',
        networkPassphrase: MAINNET_PASSPHRASE,
      });
      window.dispatchEvent(new Event('networkChange'));

      // Step 3: Signature call is attempted
      await expect(
        result.current.signTransaction(
          SAMPLE_UNSIGNED_XDR,
          TESTNET_PASSPHRASE,
          TEST_STELLAR_ADDRESS,
        ),
      ).rejects.toThrow(FreighterNetworkMismatchError);

      expect(freighterApi.signTransaction).not.toHaveBeenCalled();
    });

    it('re-checks on freighter:networkChange event', async () => {
      vi.mocked(freighterApi.getNetwork).mockResolvedValue({
        network: 'TESTNET',
        networkPassphrase: TESTNET_PASSPHRASE,
      });

      const { result } = renderHook(() => useFreighter({ networkMode: 'testnet' }));
      await waitFor(() => expect(result.current.isConnected).toBe(true));

      vi.mocked(freighterApi.getNetwork).mockResolvedValue({
        network: 'PUBLIC',
        networkPassphrase: MAINNET_PASSPHRASE,
      });
      window.dispatchEvent(new Event('freighter:networkChange'));

      await expect(
        result.current.signTransaction(
          SAMPLE_UNSIGNED_XDR,
          TESTNET_PASSPHRASE,
          TEST_STELLAR_ADDRESS,
        ),
      ).rejects.toThrow(FreighterNetworkMismatchError);

      expect(freighterApi.signTransaction).not.toHaveBeenCalled();
    });
  });

  describe('Wallet state & connection', () => {
    it('connects to Freighter and saves address and network in state', async () => {
      vi.mocked(freighterApi.isConnected).mockResolvedValue(true);
      vi.mocked(freighterApi.getAddress).mockResolvedValue({ address: TEST_STELLAR_ADDRESS });
      vi.mocked(freighterApi.getNetwork).mockResolvedValue({
        network: 'TESTNET',
        networkPassphrase: TESTNET_PASSPHRASE,
      });

      const { result } = renderHook(() => useFreighter());

      const addr = await result.current.connect();

      expect(addr).toBe(TEST_STELLAR_ADDRESS);
      await waitFor(() => expect(result.current.isConnected).toBe(true));
      expect(result.current.address).toBe(TEST_STELLAR_ADDRESS);
      expect(result.current.network).toBe('TESTNET');
      expect(result.current.networkPassphrase).toBe(TESTNET_PASSPHRASE);
    });

    it('throws if wallet is not connected when signing without addressOverride', async () => {
      vi.mocked(freighterApi.isConnected).mockResolvedValue(false);

      const { result } = renderHook(() => useFreighter());

      await expect(
        result.current.signTransaction(SAMPLE_UNSIGNED_XDR, TESTNET_PASSPHRASE),
      ).rejects.toThrow(/Wallet not connected/i);

      expect(freighterApi.signTransaction).not.toHaveBeenCalled();
    });
  });
});
