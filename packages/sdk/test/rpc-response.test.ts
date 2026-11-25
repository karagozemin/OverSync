import { describe, expect, it } from "vitest";
import {
  createSorobanRpcServer,
  createJsonRpcFetch,
  UnexpectedJsonRpcContentTypeError
} from "../src/rpc-response.js";
import { rpc } from "@stellar/stellar-sdk";
import { jsonRpcResponseFixtures } from "./fixtures/json-rpc-responses.js";

describe("JSON-RPC response content types", () => {
  it.each(jsonRpcResponseFixtures)("$name", async (fixture) => {
    const fetch = createJsonRpcFetch(async () =>
      new Response(fixture.body, {
        status: 200,
        headers: { "content-type": fixture.contentType }
      })
    );

    if (fixture.valid) {
      const response = await fetch("https://rpc.example");
      expect(response.status).toBe(200);
      return;
    }

    const error = await fetch("https://rpc.example").catch(
      (reason: unknown) => reason
    );
    expect(error).toMatchObject({
      name: "UnexpectedJsonRpcContentTypeError",
      code: "UNEXPECTED_JSON_RPC_CONTENT_TYPE"
    });
    expect(String(error)).not.toContain(fixture.body);
  });

  it("does not include response details in the typed error", async () => {
    const fetch = createJsonRpcFetch(async () =>
      new Response("<html>private proxy details</html>", {
        status: 200,
        headers: { "content-type": "text/html" }
      })
    );

    const error = await fetch("https://rpc.example/private-path").catch(
      (reason: unknown) => reason
    );

    expect(error).toBeInstanceOf(UnexpectedJsonRpcContentTypeError);
    expect(String(error)).not.toContain("private proxy details");
    expect(String(error)).not.toContain("private-path");
  });

  it("rejects invalid Soroban RPC responses before the SDK parses their bodies", async () => {
    const fixture = jsonRpcResponseFixtures.find(
      (item) => item.name === "HTML proxy response"
    );
    if (!fixture) throw new Error("Missing HTML proxy response fixture");

    const previousAdapter = rpc.AxiosClient.defaults.adapter;
    rpc.AxiosClient.defaults.adapter = async (config) => ({
      data: fixture.body,
      status: 200,
      statusText: "OK",
      headers: { "content-type": fixture.contentType },
      config
    });

    try {
      const server = createSorobanRpcServer("https://rpc.example");
      await expect(server.getLatestLedger()).rejects.toBeInstanceOf(
        UnexpectedJsonRpcContentTypeError
      );
    } finally {
      rpc.AxiosClient.defaults.adapter = previousAdapter;
    }
  });
});
