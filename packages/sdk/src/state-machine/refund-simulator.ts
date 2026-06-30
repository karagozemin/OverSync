import type { Direction } from "../types/index.js";

export type SimulatedPhase = "claimable" | "waiting" | "refundable";

export interface LegSimulation {
  chain: string;
  timelockUnix: number;
  expired: boolean;
  claimParty: string;
  refundParty: string;
}

export interface RefundSimulation {
  direction: Direction;
  src: LegSimulation;
  dst: LegSimulation;
  phase: SimulatedPhase;
  summary: string;
  readonly: true;
}

interface DirectionInfo {
  src: {
    chain: string;
    claimParty: string;
    refundParty: string;
  };
  dst: {
    chain: string;
    claimParty: string;
    refundParty: string;
  };
}

const DIRECTION_INFO: Record<Direction, DirectionInfo> = {
  eth_to_xlm: {
    src: {
      chain: "Ethereum",
      claimParty: "Recipient (Stellar address)",
      refundParty: "Sender (refundAddress)",
    },
    dst: {
      chain: "Stellar",
      claimParty: "Recipient (you)",
      refundParty: "Resolver",
    },
  },
  xlm_to_eth: {
    src: {
      chain: "Stellar",
      claimParty: "Recipient (Ethereum address)",
      refundParty: "Sender (refundAddress)",
    },
    dst: {
      chain: "Ethereum",
      claimParty: "Recipient (you)",
      refundParty: "Resolver",
    },
  },
};

export function simulateRefund(options: {
  direction: Direction;
  srcTimelockUnixSeconds: number;
  dstTimelockUnixSeconds: number;
  nowUnixSeconds?: number;
}): RefundSimulation {
  const now = options.nowUnixSeconds ?? Math.floor(Date.now() / 1000);
  const dir = DIRECTION_INFO[options.direction];

  const srcExpired = now >= options.srcTimelockUnixSeconds;
  const dstExpired = now >= options.dstTimelockUnixSeconds;

  let phase: SimulatedPhase;
  if (!srcExpired && !dstExpired) {
    phase = "claimable";
  } else if (srcExpired && dstExpired) {
    phase = "refundable";
  } else {
    phase = "waiting";
  }

  const descriptions: string[] = [];
  descriptions.push(
    `[read-only simulation] ${options.direction === "eth_to_xlm" ? "ETH → XLM" : "XLM → ETH"}`
  );

  if (phase === "claimable") {
    descriptions.push(
      `Both timelocks are still in the future. The swap is in progress.`
    );
    descriptions.push(
      `Before expiry: ${dir.src.claimParty} can claim on ${dir.src.chain}, ${dir.dst.claimParty} can claim on ${dir.dst.chain}.`
    );
  } else if (phase === "refundable") {
    descriptions.push(
      `Both timelocks have expired. Refund is available on both legs.`
    );
    descriptions.push(
      `${dir.src.refundParty} can refund on ${dir.src.chain}, ${dir.dst.refundParty} can refund on ${dir.dst.chain}.`
    );
  } else {
    descriptions.push(
      `One timelock has expired while the other is still active.`
    );
    if (srcExpired) {
      descriptions.push(
        `${dir.src.chain} timelock has expired — ${dir.src.refundParty} can refund on ${dir.src.chain}.`
      );
    } else {
      descriptions.push(
        `${dir.src.chain} timelock is still active — ${dir.src.claimParty} can still claim.`
      );
    }
    if (dstExpired) {
      descriptions.push(
        `${dir.dst.chain} timelock has expired — ${dir.dst.refundParty} can refund on ${dir.dst.chain}.`
      );
    } else {
      descriptions.push(
        `${dir.dst.chain} timelock is still active — ${dir.dst.claimParty} can still claim.`
      );
    }
  }

  return {
    direction: options.direction,
    src: {
      chain: dir.src.chain,
      timelockUnix: options.srcTimelockUnixSeconds,
      expired: srcExpired,
      claimParty: dir.src.claimParty,
      refundParty: dir.src.refundParty,
    },
    dst: {
      chain: dir.dst.chain,
      timelockUnix: options.dstTimelockUnixSeconds,
      expired: dstExpired,
      claimParty: dir.dst.claimParty,
      refundParty: dir.dst.refundParty,
    },
    phase,
    summary: descriptions.join(" "),
    readonly: true,
  };
}
