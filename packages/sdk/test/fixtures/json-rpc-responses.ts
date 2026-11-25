export const jsonRpcResponseFixtures = [
  {
    name: "application/json",
    contentType: "application/json",
    body: '{"jsonrpc":"2.0","id":1,"result":{}}',
    valid: true
  },
  {
    name: "application/json with charset",
    contentType: "application/json; charset=utf-8",
    body: '{"jsonrpc":"2.0","id":1,"result":{}}',
    valid: true
  },
  {
    name: "application/json-rpc",
    contentType: "application/json-rpc",
    body: '{"jsonrpc":"2.0","id":1,"result":{}}',
    valid: true
  },
  {
    name: "application/json-rpc with quoted charset",
    contentType: 'application/json-rpc; charset="utf-8"',
    body: '{"jsonrpc":"2.0","id":1,"result":{}}',
    valid: true
  },
  {
    name: "HTML proxy response",
    contentType: "text/html",
    body: "<html>proxy error</html>",
    valid: false
  },
  {
    name: "JSON with unexpected parameter",
    contentType: "application/json; profile=rpc",
    body: '{"jsonrpc":"2.0","id":1,"result":{}}',
    valid: false
  },
  {
    name: "missing content type",
    contentType: "",
    body: '{"jsonrpc":"2.0","id":1,"result":{}}',
    valid: false
  }
] as const;
