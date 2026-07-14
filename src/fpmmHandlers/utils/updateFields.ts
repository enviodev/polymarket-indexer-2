import { BigDecimal } from "envio";
import type { FixedProductMarketMaker } from "envio";
import { timestampToDay } from "./time";
import type { Entities } from "envio";

function updateVolumes(
  fpmm: Entity<"FixedProductMarketMaker">,
  timestamp: number,
  tradeSize: bigint,
  collateralScale: BigDecimal,
  tradeType: "Buy" | "Sell",
  // tradeType import from generated is not valid and that is throwing an error
  // but I can see in index files of generated folder that there is a named export for TradeType
): Entity<"FixedProductMarketMaker"> {
  fpmm = {
    ...fpmm,
    lastActiveDay:
      fpmm.lastActiveDay !== timestampToDay(timestamp)
        ? timestampToDay(timestamp)
        : fpmm.lastActiveDay,
  };

  let newTradeSize = fpmm.collateralVolume + tradeSize;
  let newTradeSizeScaled = BigDecimal(newTradeSize.toString()).div(
    collateralScale,
  );

  fpmm = {
    ...fpmm,
    collateralVolume: newTradeSize,
    scaledCollateralVolume: newTradeSizeScaled,
  };

  if (tradeType === "Buy") {
    let newBuySize = fpmm.collateralBuyVolume + tradeSize;
    let newBuySizeScaled = BigDecimal(newBuySize.toString()).div(
      collateralScale,
    );
    fpmm = {
      ...fpmm,
      collateralBuyVolume: newBuySize,
      scaledCollateralBuyVolume: newBuySizeScaled,
    };
  } else if (tradeType === "Sell") {
    let newSellSize = fpmm.collateralSellVolume + tradeSize;
    let newSellSizeScaled = BigDecimal(newSellSize.toString()).div(
      collateralScale,
    );
    fpmm = {
      ...fpmm,
      collateralSellVolume: newSellSize,
      scaledCollateralSellVolume: newSellSizeScaled,
    };
  }

  return fpmm;
}

function updateFeeFields(
  fpmm: Entity<"FixedProductMarketMaker">,
  feeAmount: bigint,
  collateralScale: BigDecimal,
): Entity<"FixedProductMarketMaker"> {
  const newFeeVolume = fpmm.feeVolume + feeAmount;

  return {
    ...fpmm,
    feeVolume: newFeeVolume,
    scaledFeeVolume: BigDecimal(newFeeVolume.toString()).div(collateralScale),
  };
}

function updateLiquidityFields(
  fpmm: Entity<"FixedProductMarketMaker">,
  liquidityParameter: bigint,
  collateralScale: BigDecimal,
): Entity<"FixedProductMarketMaker"> {
  return {
    ...fpmm,
    liquidityParameter: liquidityParameter,
    scaledLiquidityParameter: BigDecimal(liquidityParameter.toString()).div(
      collateralScale,
    ),
  };
}

export { updateVolumes, updateFeeFields, updateLiquidityFields };
