# Polymarket Indexer

[![Discord](https://img.shields.io/badge/Discord-Join%20Chat-7289da?logo=discord&logoColor=white)](https://discord.com/invite/envio)

An indexer for Polymarket on-chain events, built with [Envio HyperIndex](https://docs.envio.dev/docs/HyperIndex/overview). Created as a reference migration from the [Polymarket Subgraph](https://github.com/Polymarket/polymarket-subgraph).

> **Note:** This indexer is a work-in-progress and is meant as a reference implementation only. Do not use in production without thorough testing.

## What This Indexes

This indexer tracks on-chain events from Polymarket contracts on Polygon:

**Events indexed:**
- `Transfer` (USDC) - USDC transfers between wallets
- `ProxyCreation` (SafeProxyFactory) - new Polymarket wallet creation
- `TransactionRelayed` (RelayHub) - relayed transactions
- `GameCreated`, `GameSettled`, `GameEmergencySettled`, `GameCanceled`, `GamePaused`, `GameUnpaused` (UMA Sports Oracle) - sports market lifecycle
- `MarketCreated`, `MarketPaused`, `MarketUnpaused` (UMA Sports Oracle) - market management

**Chain:** Polygon (chain ID 137)

## Prerequisites

- [Node.js](https://nodejs.org/en/download/current) v22 or newer
- [pnpm](https://pnpm.io/installation) v8 or newer
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

## Quick Start

```bash
# Install dependencies
pnpm install

# Run locally (starts indexer + GraphQL API at http://localhost:8080)
pnpm dev
```

The GraphQL Playground is available at [http://localhost:8080](http://localhost:8080). Local password: `testing`.

## Regenerate Files

```bash
pnpm codegen
```

## Built With

- [Envio HyperIndex](https://docs.envio.dev/docs/HyperIndex/overview) - multichain indexing framework
- [HyperSync](https://docs.envio.dev/docs/HyperSync/overview) - high-performance blockchain data retrieval
- Based on the [Polymarket Subgraph](https://github.com/Polymarket/polymarket-subgraph)

## Related

- [Track Polymarket Trades with HyperSync](https://github.com/enviodev/track-poly-trades) - lightweight HyperSync script for Polymarket trade data
- [Polymarket Whale Tracker](https://github.com/enviodev/poly-whale-tracker) - track large Polymarket positions with HyperSync

## Documentation

- [HyperIndex Docs](https://docs.envio.dev/docs/HyperIndex/overview)
- [Getting Started with HyperIndex](https://docs.envio.dev/docs/HyperIndex/getting-started)

## Support

- [Discord community](https://discord.com/invite/envio)
- [Envio Docs](https://docs.envio.dev)
