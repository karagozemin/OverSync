import React from 'react';
import { render, screen } from '@testing-library/react';
import { AuditGateTimeline } from '../AuditGateTimeline';
import { useOrder } from '../../hooks/useOrder';
import { vi } from 'vitest';
import type { RecoveredOrder } from '../../lib/orderRecovery';

// Mock the useOrder hook
vi.mock('../../hooks/useOrder');

const mockUseOrder = vi.mocked(useOrder);

describe('AuditGateTimeline', () => {
  beforeEach(() => {
    mockUseOrder.mockReset();
    mockUseOrder.mockReturnValue({ order: null, error: null });
  });

  it('renders all timeline steps', () => {
    mockUseOrder.mockReturnValue({ order: null, error: null });
    render(<AuditGateTimeline orderId="123" />);
    
    expect(screen.getByText('Initiate')).toBeInTheDocument();
    expect(screen.getByText('Escrow')).toBeInTheDocument();
    expect(screen.getByText('Secret')).toBeInTheDocument();
    expect(screen.getByText('Claim')).toBeInTheDocument();
    expect(screen.getByText('Complete')).toBeInTheDocument();
  });

  it('advances timeline only on coordinator status change', () => {
    const { rerender } = render(<AuditGateTimeline orderId="123" />);
    
    // Initial state
    mockUseOrder.mockReturnValue({
      order: { status: 'announced' } as RecoveredOrder,
      error: null
    });
    rerender(<AuditGateTimeline orderId="123" />);
    
    // Only Initiate should be current
    expect(screen.getByText('Initiate').parentElement).toHaveClass('current');
    expect(screen.getByText('Escrow').parentElement).toHaveClass('pending');
    
    // Simulate coordinator status change to Escrowed
    mockUseOrder.mockReturnValue({
      order: { status: 'src_locked' } as RecoveredOrder,
      error: null
    });
    rerender(<AuditGateTimeline orderId="123" />);
    
    // Now Initiate should be complete, Escrow current
    expect(screen.getByText('Initiate').parentElement).toHaveClass('complete');
    expect(screen.getByText('Escrow').parentElement).toHaveClass('current');
    expect(screen.getByText('Secret').parentElement).toHaveClass('pending');
  });

  it('does not advance timeline on local click without status change', () => {
    mockUseOrder.mockReturnValue({
      order: { status: 'announced' } as RecoveredOrder,
      error: null
    });
    const { rerender } = render(<AuditGateTimeline orderId="123" />);
    
    // Simulate local click (no status change)
    mockUseOrder.mockReturnValue({
      order: { status: 'announced' } as RecoveredOrder,
      error: null
    });
    rerender(<AuditGateTimeline orderId="123" />);
    
    // Timeline should not advance
    expect(screen.getByText('Initiate').parentElement).toHaveClass('current');
    expect(screen.getByText('Escrow').parentElement).toHaveClass('pending');
  });

  it('does not move timeline backward for older order responses', () => {
    // Start with a more advanced status
    mockUseOrder.mockReturnValue({
      order: { status: 'src_locked' } as RecoveredOrder,
      error: null
    });
    const { rerender } = render(<AuditGateTimeline orderId="123" />);
    
    // Simulate receiving an older response with Pending status
    mockUseOrder.mockReturnValue({
      order: { status: 'announced' } as RecoveredOrder,
      error: null
    });
    rerender(<AuditGateTimeline orderId="123" />);
    
    // Timeline should remain at Escrow
    expect(screen.getByText('Initiate').parentElement).toHaveClass('complete');
    expect(screen.getByText('Escrow').parentElement).toHaveClass('current');
  });

  it('shows error step for unknown status', () => {
    // Mock an unknown status (not in STATUS_TO_STEP)
    mockUseOrder.mockReturnValue({
      order: { status: 'UNKNOWN' } as RecoveredOrder,
      error: null
    });
    render(<AuditGateTimeline orderId="123" />);
    
    // Current step should show error
    expect(screen.getByText('Initiate').parentElement).toHaveClass('error');
  });

  it('marks claim step complete only on coordinator claim status', () => {
    mockUseOrder.mockReturnValue({
      order: { status: 'secret_revealed' } as RecoveredOrder,
      error: null
    });
    render(<AuditGateTimeline orderId="123" />);
    
    expect(screen.getByText('Initiate').parentElement).toHaveClass('complete');
    expect(screen.getByText('Escrow').parentElement).toHaveClass('complete');
    expect(screen.getByText('Secret').parentElement).toHaveClass('complete');
    expect(screen.getByText('Claim').parentElement).toHaveClass('current');
    expect(screen.getByText('Complete').parentElement).toHaveClass('pending');
  });
});
