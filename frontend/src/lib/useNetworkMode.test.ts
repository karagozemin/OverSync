import { renderHook, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { useNetworkMode } from './useNetworkMode'

vi.mock('@stellar/freighter-api', () => ({
  isConnected: vi.fn().mockResolvedValue(false),
  getNetwork: vi.fn().mockResolvedValue(null),
}))

beforeEach(() => {
  vi.stubEnv('VITE_MAINNET_ENABLED', 'false')
  window.history.replaceState({}, '', '/?network=mainnet')
  Object.defineProperty(window, 'ethereum', {
    writable: true,
    value: {
      request: vi.fn().mockResolvedValue('0xaa36a7'),
    },
  })
})

test('requested mainnet stays alive while disabled and gate state disables UI actions', async () => {
  const { result } = renderHook(() => useNetworkMode({ ethAddress: '0x1234567890123456789012345678901234567890', stellarAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890' }))

  await waitFor(() => expect(result.current.requestedMode).toBe('mainnet'))
  expect(result.current.mode).toBe('testnet')
  expect(result.current.guard.status).toBe('mainnet_gated')
  expect(result.current.guard.disableUiActions).toBe(true)
  expect(result.current.guard.reason).toMatch(/Mainnet operations are currently gated/i)
})
