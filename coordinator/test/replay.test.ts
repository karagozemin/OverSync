import { describe, it, expect } from "vitest";
import { ReplayArgsSchema } from "../src/replay.js";

describe("replay argument parsing", () => {
  it("should parse valid ethereum args", () => {
    const args = ReplayArgsSchema.parse({
      chain: "ethereum",
      from: "1000",
      to: "2000"
    });
    expect(args).toEqual({
      chain: "ethereum",
      from: 1000,
      to: 2000
    });
  });

  it("should parse valid soroban args", () => {
    const args = ReplayArgsSchema.parse({
      chain: "soroban",
      from: 5000,
      to: 6000
    });
    expect(args).toEqual({
      chain: "soroban",
      from: 5000,
      to: 6000
    });
  });

  it("should fail on invalid chain", () => {
    expect(() => {
      ReplayArgsSchema.parse({
        chain: "bitcoin",
        from: 100,
        to: 200
      });
    }).toThrow();
  });

  it("should fail on negative blocks", () => {
    expect(() => {
      ReplayArgsSchema.parse({
        chain: "ethereum",
        from: -5,
        to: 100
      });
    }).toThrow();
  });
});
