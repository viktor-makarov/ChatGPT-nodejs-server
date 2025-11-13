

let _clientPromise;
let _streamableHTTPClientTransport;

async function McpClient() {
  if (!_clientPromise) {
    _clientPromise = import('@modelcontextprotocol/sdk/client/index.js')
      .then(m => m.Client); // сам _clientPromise сразу "становится" промисом Client-а
  }
  return _clientPromise; // всегда возвращаем один и тот же промис Client-а
}

async function StreamableHTTPClientTransport() {
  if (!_streamableHTTPClientTransport) {
    _streamableHTTPClientTransport = import('@modelcontextprotocol/sdk/client/streamableHttp.js')
      .then(m => m.StreamableHTTPClientTransport); // сам _clientPromise сразу "становится" промисом Client-а
  }
  return _streamableHTTPClientTransport; // всегда возвращаем один и тот же промис Client-а
}


module.exports = { 
    McpClient,
    StreamableHTTPClientTransport
};