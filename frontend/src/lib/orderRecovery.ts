import { OrderStatus } from '@over-sync/coordinator';

// Centralized mapping of coordinator statuses to timeline steps
export const STATUS_TO_STEP: Record<OrderStatus, number> = {
  [OrderStatus.Pending]: 0,
  [OrderStatus.Escrowed]: 1,
  [OrderStatus.SecretSubmitted]: 2,
  [OrderStatus.Claimed]: 3,
  [OrderStatus.Completed]: 4,
  [OrderStatus.Failed]: -1
};

/**
 * Determines if a status transition should advance the timeline
 * @param currentStep - Current timeline step
 * @param newStatus - New coordinator status
 * @returns true if the timeline should advance
 */
export function shouldAdvanceTimeline(currentStep: number, newStatus: OrderStatus): boolean {
  const newStep = STATUS_TO_STEP[newStatus];
  return newStep !== undefined && newStep > currentStep;
}

/**
 * Gets the current step from a coordinator status
 * @param status - Coordinator status
 * @returns Timeline step or undefined for unknown statuses
 */
export function getStepFromStatus(status: OrderStatus): number | undefined {
  return STATUS_TO_STEP[status];
}
