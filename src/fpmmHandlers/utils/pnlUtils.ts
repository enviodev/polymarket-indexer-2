import type { TradeType_t } from "generated/src/db/Enums.gen";
import { COLLATERAL_SCALE } from "../../conditionalTokensHandlers/constants";
import type { Exchange_OrderFilled_event, FixedProductMarketMaker_FPMMFundingAdded_event } from "envio";

export const computeFpmmPrice = (
  amounts: readonly [bigint, bigint],
  outcomeIndex: 0 | 1,
): bigint => {
  const denom = amounts[0] + amounts[1];
  if (denom === 0n) return 0n;

  const amount = amounts[1 - outcomeIndex];
  if (!amount) return 0n;

  return (amount * COLLATERAL_SCALE) / denom;
};

type FundingAddedSendback = {
  outcomeIndex: number;
  price: bigint;
  amount: bigint;
};

export const parseFundingAddedSendBack = (
  event: FixedProductMarketMaker_FPMMFundingAdded_event,
): FundingAddedSendback => {
  // Safely read amountsAdded from the event (may be undefined)
  const amountsAdded: [bigint, bigint] = [
    event.params.amountsAdded?.[0] ?? 0n,
    event.params.amountsAdded?.[1] ?? 0n,
  ];
  const outcomeIndex: 0 | 1 = amountsAdded[0] > amountsAdded[1] ? 1 : 0;

  let amount: bigint;
  if (outcomeIndex === 0) {
    amount = amountsAdded[1] - amountsAdded[0];
  } else {
    amount = amountsAdded[0] - amountsAdded[1];
  }
  const price = computeFpmmPrice(amountsAdded, outcomeIndex);

  return {
    outcomeIndex,
    price,
    amount,
  };
};

export type Order = {
  account: string;
  side: TradeType_t;
  baseAmount: bigint;
  quoteAmount: bigint;
  positionId: bigint;
};

export const parseOrderFilled = (event: Exchange_OrderFilled_event): Order => {
  const side: TradeType_t = event.params.makerAssetId == 0n ? "Buy" : "Sell";

  return side == "Buy"
    ? {
        account: event.params.maker,
        side,
        baseAmount: event.params.takerAmountFilled,
        quoteAmount: event.params.makerAmountFilled,
        positionId: event.params.takerAssetId,
      }
    : {
        account: event.params.taker,
        side,
        baseAmount: event.params.makerAmountFilled,
        quoteAmount: event.params.takerAmountFilled,
        positionId: event.params.makerAssetId,
      };
};
