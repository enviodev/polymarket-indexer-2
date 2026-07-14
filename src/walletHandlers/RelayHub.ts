import { indexer } from "envio";
import {
  PROXY_WALLET_FACTORY,
  PROXY_WALLET_IMPLEMENTATION,
} from "../common/constants";
import { computeProxyWalletAddress } from "../common/utils/computeProxyWalletAddress";
import type { Wallet_t } from "envio";

indexer.onEvent(
  { contract: "RelayHub", event: "TransactionRelayed" },
  async ({ event, context }) => {
  if (event.params.to == PROXY_WALLET_FACTORY.toLowerCase()) {
    return;
  }

  const walletAddress = computeProxyWalletAddress(
    event.params.from as `0x${string}`,
    PROXY_WALLET_FACTORY,
    PROXY_WALLET_IMPLEMENTATION
  );

  const wallet = await context.Wallet.get(walletAddress);

  if (!wallet) {
    // this will save us few DB writes
    const newWallet: Wallet_t = {
      id: walletAddress,
      signer: event.params.from,
      walletType: "Proxy",
      balance: BigInt(0),
      lastTransfer: 0,
      createdAt: event.block.timestamp,
    };
    context.Wallet.set(newWallet);
  }
}
);
