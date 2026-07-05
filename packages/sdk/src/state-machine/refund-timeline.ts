export type SimulatorDirection = "eth_to_xlm" | "xlm_to_eth";

export type SimulatedState = "waiting" | "claimable" | "refundable";

export interface RefundTimelineInput {
  direction: SimulatorDirection;
  sourceTimelockUnixSeconds: number;
  destinationTimelockUnixSeconds: number;
  sourceLockObserved: boolean;
  destinationLockObserved: boolean;
  nowUnixSeconds?: number;
}

export interface RefundTimelineResult {
  state: SimulatedState;
  stateLabel: string;
  stateDescription: string;
  sourceTimelockExpiry: Date;
  destinationTimelockExpiry: Date;
  claimableBy: string;
  refundableBy: string;
  isReadonly: true;
}

const DIRECTION_LABELS: Record<SimulatorDirection, { source: string; destination: string }> = {
  eth_to_xlm: { source: "Ethereum", destination: "Stellar" },
  xlm_to_eth: { source: "Stellar", destination: "Ethereum" },
};

function describeState(
  state: SimulatedState,
  labels: { source: string; destination: string },
  srcExpired: boolean,
  dstExpired: boolean,
): { label: string; description: string } {
  switch (state) {
    case "waiting":
      return {
        label: "Waiting",
        description: `The ${labels.destination} lock has not been observed yet, or timelocks are still active. No action is available yet.`,
      };
    case "claimable":
      return {
        label: "Claimable",
        description: `Funds are locked on ${labels.destination}. You can claim them before the destination timelock expires by providing the correct hashlock preimage.`,
      };
    case "refundable":
      return {
        label: "Refundable",
        description: `The ${labels.source} timelock has expired. You can refund your original deposit from the ${labels.source} HTLC contract.`,
      };
  }
}

export function simulateRefundTimeline(input: RefundTimelineInput): RefundTimelineResult {
  const now = input.nowUnixSeconds ?? Math.floor(Date.now() / 1000);
  const labels = DIRECTION_LABELS[input.direction];

  const srcExpired = now >= input.sourceTimelockUnixSeconds;
  const dstExpired = now >= input.destinationTimelockUnixSeconds;

  let state: SimulatedState;
  if (srcExpired) {
    state = "refundable";
  } else if (input.destinationLockObserved && !dstExpired) {
    state = "claimable";
  } else {
    state = "waiting";
  }

  const { label, description } = describeState(state, labels, srcExpired, dstExpired);

  const claimDesc =
    input.direction === "eth_to_xlm"
      ? "You can claim XLM on Stellar (destination) before the destination timelock expires."
      : "You can claim ETH on Ethereum (destination) before the destination timelock expires.";

  const refundDesc =
    input.direction === "eth_to_xlm"
      ? "You can refund ETH on Ethereum (source) after the source timelock expires."
      : "You can refund XLM on Stellar (source) after the source timelock expires.";

  return {
    state,
    stateLabel: label,
    stateDescription: description,
    sourceTimelockExpiry: new Date(input.sourceTimelockUnixSeconds * 1000),
    destinationTimelockExpiry: new Date(input.destinationTimelockUnixSeconds * 1000),
    claimableBy: claimDesc,
    refundableBy: refundDesc,
    isReadonly: true,
  };
}
