import { indexer } from "envio";

indexer.onEvent(
  { contract: "USDC", event: "Transfer" },
  async ({ event, context }) => {
  /// TODO: understand the use of GlobalUSDCBalance entity used in polymarket subgraph

  // 'to' address balance update
  let toAddress = await context.Wallet.get(event.params.to);

  if (toAddress != undefined) {
    toAddress = {
      ...toAddress,
      balance: toAddress.balance + event.params.value,
      lastTransfer: event.block.timestamp,
    };

    context.Wallet.set(toAddress);
  }

  // 'from' address balance update
  let fromAddress = await context.Wallet.get(event.params.from);

  if (fromAddress != undefined) {
    fromAddress = {
      ...fromAddress,
      balance: fromAddress.balance - event.params.value,
      lastTransfer: event.block.timestamp,
    };

    context.Wallet.set(fromAddress);
  }
}
);
