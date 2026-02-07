export default function Page() {
  return (
    <>
      <h1>eXpress402</h1>
      <p>
        Deployed on Vercel as a minimal Next.js wrapper. The core repo still provides the x402 + SIWx
        + Yellow MCP tooling for local agent runs.
      </p>

      <h2>API</h2>
      <ul>
        <li>
          <a href="/api/stock_price?symbol=AAPL">/api/stock_price?symbol=AAPL</a>
        </li>
        <li>
          <a href="/api/market_rumors?symbol=BTC">/api/market_rumors?symbol=BTC</a>
        </li>
      </ul>

      <h2>Local demos</h2>
      <ul>
        <li>
          <code>npm run demo:sentifi</code> (Sentifi dashboard, local dev)
        </li>
        <li>
          <code>npm run demo</code> (AgentKit demo)
        </li>
      </ul>
    </>
  );
}

