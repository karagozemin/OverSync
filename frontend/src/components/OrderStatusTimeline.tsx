import React, { useEffect, useState } from 'react';
import { useOrder } from '../hooks/useOrder';
import type { RecoveredOrderStatus } from '../lib/orderRecovery';

// Map coordinator statuses to timeline steps
const STATUS_TO_STEP: Partial<Record<RecoveredOrderStatus, number>> = {
  announced: 0,
  src_locked: 1,
  dst_locked: 2,
  secret_revealed: 3,
  completed: 4,
};

type TimelineStep = {
  id: number;
  label: string;
  status: 'pending' | 'complete' | 'error' | 'current';
};

const STEPS: TimelineStep[] = [
  { id: 0, label: 'Initiate', status: 'pending' },
  { id: 1, label: 'Escrow', status: 'pending' },
  { id: 2, label: 'Secret', status: 'pending' },
  { id: 3, label: 'Claim', status: 'pending' },
  { id: 4, label: 'Complete', status: 'pending' }
];

export function OrderStatusTimeline({ orderId }: { orderId: string }) {
  return <OrderStatusTimelineContent key={orderId} orderId={orderId} />;
}

const OrderStatusTimelineContent: React.FC<{ orderId: string }> = ({ orderId }) => {
  const { order, error } = useOrder(orderId);
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [steps, setSteps] = useState<TimelineStep[]>(STEPS);

  useEffect(() => {
    if (error) {
      setSteps(prev => prev.map(step => ({ ...step, status: 'error' })));
      return;
    }

    if (!order) return;

    const newStep = STATUS_TO_STEP[order.status];

    // Ignore older responses that would move the timeline backward
    if (newStep !== undefined && newStep > currentStep) {
      setCurrentStep(newStep);
    }

    // Update step statuses based on currentStep
    setSteps(prev =>
      prev.map(step => ({
        ...step,
        status:
          step.id < currentStep ? 'complete' :
          step.id === currentStep ? 'current' :
          'pending'
      }))
    );

    // Handle unknown status
    if (newStep === undefined) {
      setSteps(prev =>
        prev.map(step => ({
          ...step,
          status: step.id === currentStep ? 'error' : step.status
        }))
      );
    }
  }, [order, error, currentStep]);

  return (
    <div className="audit-gate-timeline">
      {steps.map(step => (
        <div
          key={step.id}
          className={`timeline-step ${step.status}`}
        >
          <div className="step-marker" />
          <div className="step-label">{step.label}</div>
        </div>
      ))}
    </div>
  );
};
