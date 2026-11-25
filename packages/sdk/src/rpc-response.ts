import { rpc } from "@stellar/stellar-sdk";

const VALID_JSON_RPC_CONTENT_TYPE =
  /^application\/(?:json|json-rpc)(?:\s*;\s*charset\s*=\s*(?:"[^"]+"|[a-z0-9._-]+))?\s*$/i;

export class UnexpectedJsonRpcContentTypeError extends Error {
  readonly code = "UNEXPECTED_JSON_RPC_CONTENT_TYPE";

  constructor() {
    super(
      "Unexpected JSON-RPC response content type; expected application/json or application/json-rpc"
    );
    this.name = "UnexpectedJsonRpcContentTypeError";
  }
}

export function assertJsonRpcResponseContentType(contentType: string | null): void {
  if (!contentType || !VALID_JSON_RPC_CONTENT_TYPE.test(contentType.trim())) {
    throw new UnexpectedJsonRpcContentTypeError();
  }
}

export function createJsonRpcFetch(fetchImplementation: typeof fetch = fetch): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await fetchImplementation(input, init);
    assertJsonRpcResponseContentType(response.headers.get("content-type"));
    return response;
  };
}

let sorobanResponseInterceptorInstalled = false;
const sorobanRpcUrls = new Set<string>();

function normalizeRpcUrl(url: string, baseUrl?: string): string {
  const parsed = new URL(url, baseUrl);
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`;
}

function installSorobanResponseContentTypeGuard(): void {
  if (sorobanResponseInterceptorInstalled) return;

  rpc.AxiosClient.interceptors.response.use((response) => {
    const responseUrl = response.config.url;
    if (
      responseUrl &&
      sorobanRpcUrls.has(normalizeRpcUrl(responseUrl, response.config.baseURL))
    ) {
      const contentType = response.headers["content-type"];
      assertJsonRpcResponseContentType(
        typeof contentType === "string" ? contentType : null
      );
    }
    return response;
  });
  sorobanResponseInterceptorInstalled = true;
}

export function createSorobanRpcServer(
  url: string,
  options?: ConstructorParameters<typeof rpc.Server>[1]
): rpc.Server {
  sorobanRpcUrls.add(normalizeRpcUrl(url));
  installSorobanResponseContentTypeGuard();
  return new rpc.Server(url, options);
}
