import { indexer, BigDecimal } from "envio";
import type {
  Orderbook_t,
  OrderFilledEvent_t,
} from "envio";
import { parseOrderFilled, type Order } from "../fpmmHandlers/utils/pnlUtils";
import { COLLATERAL_SCALE } from "../conditionalTokensHandlers/constants";
import {
  updateUserPositionWithBuy,
  updateUserPositionWithSell,
} from "../conditionalTokensHandlers/utils";

const BIG_ZERO = 0n;
const COLLATERAL_SCALE_DEC = new BigDecimal(10).pow(6);
const ORDERS_MATCHED_GLOBAL_ID = "OrdersMatchedGlobal";

indexer.onEvent(
  { contract: "Exchange", event: "OrderFilled" },
  async ({ event, context }) => {
  BigDecimal;
  const {
    fee,
    maker,
    makerAmountFilled,
    makerAssetId,
    orderHash,
    taker,
    takerAmountFilled,
    takerAssetId,
  } = event.params;

  const { timestamp } = event.block;
  const txHash = event.transaction.hash;

  const side = getOrderSide(makerAssetId);
  const size = getOrderSize(makerAmountFilled, takerAmountFilled, side);

  const tokenId =
    side === "Buy" ? takerAssetId.toString() : makerAssetId.toString();

  // -----------------------------
  // Store order filled event
  // -----------------------------
  const orderFilled: OrderFilledEvent_t = {
    id: `${txHash}_${orderHash}`,
    hash: txHash,
    timestamp,
    orderHash,
    maker,
    taker,
    makerAssetId: makerAssetId.toString(),
    takerAssetId: takerAssetId.toString(),
    makerAmountFilled,
    takerAmountFilled,
    fee,
  };

  context.OrderFilledEvent.set(orderFilled);

  // -----------------------------
  // Update orderbook
  // -----------------------------
  const baseOrderbook: Orderbook_t = {
    id: tokenId,
    tradesQuantity: 0n,
    buysQuantity: 0n,
    sellsQuantity: 0n,
    collateralVolume: 0n,
    scaledCollateralVolume: new BigDecimal(0),
    collateralBuyVolume: 0n,
    scaledCollateralBuyVolume: BigDecimal(0),
    collateralSellVolume: 0n,
    scaledCollateralSellVolume: BigDecimal(0),
  };

  const existing = await context.Orderbook.getOrCreate(baseOrderbook);

  const commonUpdates = {
    collateralVolume: existing.collateralVolume + size,
    scaledCollateralVolume:
      existing.scaledCollateralVolume.div(COLLATERAL_SCALE_DEC),
    tradesQuantity: existing.tradesQuantity + 1n,
  };

  const sideUpdates =
    side === "Buy"
      ? {
          buysQuantity: existing.buysQuantity + 1n,
          collateralBuyVolume: existing.collateralBuyVolume + size,
          scaledCollateralBuyVolume:
            existing.scaledCollateralBuyVolume.div(COLLATERAL_SCALE_DEC),
        }
      : {
          sellsQuantity: existing.sellsQuantity + 1n,
          collateralSellVolume: existing.collateralSellVolume + size,
          scaledCollateralSellVolume:
            existing.scaledCollateralSellVolume.div(COLLATERAL_SCALE_DEC),
        };

  const updatedOrderbook: Orderbook_t = {
    ...existing,
    ...commonUpdates,
    ...sideUpdates,
  };

  context.Orderbook.set(updatedOrderbook);

  // https://github.com/Polymarket/polymarket-subgraph/blob/main/pnl-subgraph/src/ExchangeMapping.ts#L23-L44

  const order: Order = parseOrderFilled(event);
  const price = (order.quoteAmount * COLLATERAL_SCALE) / order.baseAmount;

  if (order.side === "Buy") {
    updateUserPositionWithBuy(
      context,
      order.account as `0x${string}`,
      order.positionId,
      price,
      order.baseAmount,
    );
  } else {
    updateUserPositionWithSell(
      context,
      order.account as `0x${string}`,
      order.positionId,
      price,
      order.baseAmount,
    );
  }
}
);

function getOrderSide(makerAssetId: bigint): "Buy" | "Sell" {
  return makerAssetId === BIG_ZERO ? "Buy" : "Sell";
}

function getOrderSize(
  makerAmountFilled: bigint,
  takerAmountFilled: bigint,
  side: "Buy" | "Sell",
): bigint {
  return side === "Buy" ? makerAmountFilled : takerAmountFilled;
}

indexer.onEvent(
  { contract: "Exchange", event: "OrdersMatched" },
  async ({ event, context }) => {
  // NOTE: maker/taker amounts are intentionally flipped
  const makerAmountFilled = event.params.takerAmountFilled;
  const takerAmountFilled = event.params.makerAmountFilled;

  const side = getOrderSide(event.params.makerAssetId);
  const size = getOrderSize(makerAmountFilled, takerAmountFilled, side);

  // -----------------------------
  // Store OrdersMatched event
  // -----------------------------
  const ordersMatchedEvent = {
    id: `${event.transaction.hash}_${event.logIndex}`,
    hash: event.transaction.hash,
    timestamp: event.block.timestamp,
    makerAssetID: event.params.makerAssetId,
    takerAssetID: event.params.takerAssetId,
    makerAmountFilled: event.params.makerAmountFilled,
    takerAmountFilled: event.params.takerAmountFilled,
  };

  context.OrdersMatchedEvent.set(ordersMatchedEvent);

  // -----------------------------
  // Update global stats
  // -----------------------------
  const baseGlobal = {
    id: ORDERS_MATCHED_GLOBAL_ID,
    tradesQuantity: 0n,
    buysQuantity: 0n,
    sellsQuantity: 0n,

    collateralVolume: BigDecimal(0),
    scaledCollateralVolume: BigDecimal(0),

    collateralBuyVolume: BigDecimal(0),
    scaledCollateralBuyVolume: BigDecimal(0),

    collateralSellVolume: BigDecimal(0),
    scaledCollateralSellVolume: BigDecimal(0),
  };

  const existing = await context.OrdersMatchedGlobal.getOrCreate(baseGlobal);

  const commonUpdates = {
    tradesQuantity: existing.tradesQuantity + 1n,
    collateralVolume: existing.collateralVolume.plus(size.toString()),
    scaledCollateralVolume:
      existing.scaledCollateralVolume.div(COLLATERAL_SCALE_DEC),
  };

  const sideUpdates =
    side === "Buy"
      ? {
          buysQuantity: existing.buysQuantity + 1n,
          collateralBuyVolume: existing.collateralBuyVolume.plus(
            size.toString(),
          ),
          scaledCollateralBuyVolume:
            existing.scaledCollateralBuyVolume.div(COLLATERAL_SCALE_DEC),
        }
      : {
          sellsQuantity: existing.sellsQuantity + 1n,
          collateralSellVolume: existing.collateralSellVolume.plus(
            size.toString(),
          ),
          scaledCollateralSellVolume:
            existing.scaledCollateralSellVolume.div(COLLATERAL_SCALE_DEC),
        };

  const updatedGlobal = {
    ...existing,
    ...commonUpdates,
    ...sideUpdates,
  };

  context.OrdersMatchedGlobal.set(updatedGlobal);
}
);

indexer.onEvent(
  { contract: "Exchange", event: "TokenRegistered" },
  async ({ event, context }) => {
  const { token0, token1, conditionId } = event.params;

  await ensureMarketData(context, token0.toString(), conditionId, undefined);

  await ensureMarketData(context, token1.toString(), conditionId, 1n);
}
);

// -----------------------------
// Helpers
// -----------------------------
async function ensureMarketData(
  context: any,
  id: string,
  conditionId: string,
  outcomeIndex?: bigint,
) {
  const existing = await context.MarketData.get(id);
  if (existing) return;

  context.MarketData.set({
    id,
    condition: conditionId,
    outcomeIndex,
  });
}
