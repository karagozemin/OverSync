import { xdr } from "@stellar/stellar-sdk";
import type { SorobanRawEvent } from "./listeners/soroban.js";
import type { SorobanOrderCreatedEvent } from "./planner/index.js";

export type DecodedSorobanEvent =
  | { type: "OrderCreated"; event: SorobanOrderCreatedEvent }
  | { type: "OrderClaimed"; orderId: string; claimer: string }
  | { type: "OrderRefunded"; orderId: string };

export function decodeSorobanEvent(raw: SorobanRawEvent): DecodedSorobanEvent | null {
  try {
    const topics = raw.topics.map((t) => {
      const parsed = xdr.ScVal.fromXDR(t, "base64");
      return symbolValue(parsed);
    });

    const eventType = topics[0];
    if (!eventType) return null;

    const value = xdr.ScVal.fromXDR(raw.value, "base64");
    const fields = scvMapToRecord(value);

    switch (eventType) {
      case "OrderCreated":
        return {
          type: "OrderCreated",
          event: {
            orderId: String(fields.order_id ?? fields.orderId ?? ""),
            sender: String(fields.sender ?? ""),
            beneficiary: String(fields.beneficiary ?? ""),
            token: String(fields.token ?? ""),
            amount: BigInt(String(fields.amount ?? "0")),
            safetyDeposit: BigInt(String(fields.safety_deposit ?? fields.safetyDeposit ?? "0")),
            hashlock: String(fields.hashlock ?? ""),
            timelock: Number(fields.timelock ?? 0),
          },
        };
      case "OrderClaimed":
        return {
          type: "OrderClaimed",
          orderId: String(fields.order_id ?? fields.orderId ?? ""),
          claimer: String(fields.claimer ?? ""),
        };
      case "OrderRefunded":
        return {
          type: "OrderRefunded",
          orderId: String(fields.order_id ?? fields.orderId ?? ""),
        };
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function symbolValue(scVal: xdr.ScVal): string {
  const sym = scVal.sym();
  return sym.toString();
}

function scvMapToRecord(scVal: xdr.ScVal): Record<string, unknown> {
  const map = scVal.map();
  if (!map) return {};
  const result: Record<string, unknown> = {};
  for (const entry of map) {
    const k = symbolValue(entry.key());
    result[k] = scValToPrimitive(entry.val());
  }
  return result;
}

function scValToPrimitive(scVal: xdr.ScVal): unknown {
  switch (scVal.switch()) {
    case xdr.ScValType.scvBool():
      return scVal.b();
    case xdr.ScValType.scvVoid():
      return null;
    case xdr.ScValType.scvI32():
      return scVal.i32();
    case xdr.ScValType.scvI64():
      return Number(scVal.i64().toString());
    case xdr.ScValType.scvU64():
      return Number(scVal.u64().toString());
    case xdr.ScValType.scvI128():
      return scVal.i128().toString();
    case xdr.ScValType.scvU128():
      return scVal.u128().toString();
    case xdr.ScValType.scvBytes():
      return scVal.bytes().toString("hex");
    case xdr.ScValType.scvString():
      return scVal.str().toString();
    case xdr.ScValType.scvSymbol():
      return scVal.sym().toString();
    case xdr.ScValType.scvAddress():
      return scVal.address().toString();
    case xdr.ScValType.scvVec(): {
      const vec = scVal.vec();
      return vec ? vec.map((v) => scValToPrimitive(v!)) : [];
    }
    case xdr.ScValType.scvMap():
      return scvMapToRecord(scVal);
    default:
      return scVal.toXDR("base64");
  }
}
