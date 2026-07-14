import { indexer } from "envio";
import { getEventId } from "../common/utils/getEventId";

indexer.onEvent(
  { contract: "FeeModule", event: "FeeRefunded" },
  async ({ event, context }) => {
  const { id, to, orderHash, refund, feeCharged } = event.params;

  let negRisk = false;
  if (event.srcAddress == indexer.chains[137].FeeModule.addresses[1]) {
    negRisk = true;
  }

  context.FeeRefundedEntity.set({
    id: getEventId(event.transaction.hash, event.logIndex),
    tokenId: id.toString(),
    refundee: to,
    orderHash: orderHash,
    timestamp: event.block.timestamp,
    feeRefunded: refund,
    feeCharged: feeCharged,
    negRisk: negRisk,
  });
}
);
