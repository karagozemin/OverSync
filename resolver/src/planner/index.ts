import type { ResolverConfig } from "../config.js";
import type { EthereumOrderCreatedEvent } from "../listeners/ethereum.js";

export interface DestinationOrderPlan {
  direction: "eth_to_xlm" | "xlm_to_eth";
  hashlock: string;
  amount: bigint;
  destinationAddress: string;
  sourceOrderId: string;
  sourceChain: string;
  timelock: number;
}

export function planDestinationOrder(params: {
  direction: "eth_to_xlm" | "xlm_to_eth";
  sourceOrder: EthereumOrderCreatedEvent | SorobanOrderCreatedEvent;
  cfg: ResolverConfig;
}): DestinationOrderPlan {
  const { direction, sourceOrder } = params;

  if (direction === "eth_to_xlm") {
    const src = sourceOrder as EthereumOrderCreatedEvent;
    return {
      direction,
      hashlock: src.hashlock,
      amount: src.amount,
      destinationAddress: src.beneficiary,
      sourceOrderId: src.orderId.toString(),
      sourceChain: "ethereum",
      timelock: Number(src.timelock),
    };
  }

  const src = sourceOrder as SorobanOrderCreatedEvent;
  return {
    direction,
    hashlock: src.hashlock,
    amount: src.amount,
    destinationAddress: src.beneficiary,
    sourceOrderId: src.orderId,
    sourceChain: "stellar",
    timelock: src.timelock,
  };
}

export interface SorobanOrderCreatedEvent {
  orderId: string;
  sender: string;
  beneficiary: string;
  token: string;
  amount: bigint;
  safetyDeposit: bigint;
  hashlock: string;
  timelock: number;
}
