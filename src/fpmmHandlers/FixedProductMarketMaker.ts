
import { indexer, BigDecimal, type FixedProductMarketMaker } from "envio";
import { increment, max } from "./utils/maths";
import {
  updateFeeFields,
  updateLiquidityFields,
  updateVolumes,
} from "./utils/updateFields";
import { getEventId } from "../common/utils/getEventId";
import { getCollateralScale } from "./utils/collateralToken";
import { calculatePrices } from "./utils/calculatePrices";
import { nthRoot } from "./utils/nthRoot";
import type { FpmmFundingAddition } from "envio";
import { COLLATERAL_SCALE } from "../conditionalTokensHandlers/constants";
import {
  updateUserPositionWithBuy,
  updateUserPositionWithSell,
} from "../conditionalTokensHandlers/utils";
import { computeFpmmPrice, parseFundingAddedSendBack } from "./utils/pnlUtils";
import type { Entities } from "envio";

indexer.onEvent(
  { contract: "FixedProductMarketMaker", event: "FPMMBuy" },
  async ({ event, context }) => {
  let fpmmAddress = event.srcAddress;
  let fpmm = await context.FixedProductMarketMaker.get(fpmmAddress);
  if (!fpmm) {
    context.log.error(
      `cannot buy: FixedProductMarketMaker instance for ${fpmmAddress} not found`,
    );
    return;
  }

  // let fpmm: DeepMutable<Entity<"FixedProductMarketMaker">> = {
  //   ...entity,
  //   conditions: [...entity.conditions],
  //   outcomeTokenAmounts: [...entity.outcomeTokenAmounts],
  //   outcomeTokenPrices: [...entity.outcomeTokenPrices],
  // };

  let oldAmounts = fpmm!.outcomeTokenAmounts;
  let investmentAmountMinusFees =
    event.params.investmentAmount - event.params.feeAmount;
  const outcomeIndex = Number(event.params.outcomeIndex);

  let newAmounts = new Array<bigint>(oldAmounts.length);
  let amountsProduct = BigInt(1);

  for (let i = 0; i < oldAmounts.length; i++) {
    const old = oldAmounts[i];
    if (old === undefined) {
      // skip missing entries (or handle as needed)
      continue;
    }
    const value: bigint =
      i === outcomeIndex
        ? old + investmentAmountMinusFees - event.params.outcomeTokensBought
        : old + investmentAmountMinusFees;

    newAmounts[i] = value;
    amountsProduct *= value;
  }

  fpmm = {
    ...fpmm,
    outcomeTokenAmounts: newAmounts,
    outcomeTokenPrices: calculatePrices(newAmounts),
  };

  let liquidityParameter = nthRoot(amountsProduct, oldAmounts.length, context);
  let collateralScale = getCollateralScale(fpmm!.collateralToken_id, context);
  let collateralScaleDec = BigDecimal(collateralScale.toString());

  fpmm = updateLiquidityFields(fpmm, liquidityParameter, collateralScaleDec);

  fpmm = updateVolumes(
    fpmm,
    event.block.timestamp,
    event.params.investmentAmount,
    collateralScaleDec,
    "Buy",
  );

  fpmm = updateFeeFields(fpmm, event.params.feeAmount, collateralScaleDec);

  fpmm = {
    ...fpmm,
    tradesQuantity: increment(fpmm!.tradesQuantity),
    buysQuantity: increment(fpmm!.buysQuantity),
  };

  context.FixedProductMarketMaker.set(fpmm);

  // record buy transaction
  context.FpmmTransaction.set({
    id: getEventId(event.transaction.hash, event.logIndex),
    type: "Buy",
    timestamp: event.block.timestamp,
    market_id: event.srcAddress,
    user: event.params.buyer,
    tradeAmount: event.params.investmentAmount,
    feeAmount: event.params.feeAmount,
    outcomeIndex: BigInt(outcomeIndex),
    outcomeTokensAmount: event.params.outcomeTokensBought,
  });

  // https://github.com/Polymarket/polymarket-subgraph/blob/main/pnl-subgraph/src/FixedProductMarketMakerMapping.ts#L24-L52

  if (event.params.outcomeTokensBought == 0n) {
    context.log.warn(
      `Zero outcome tokens bought in FPMMBuy event at tx ${event.transaction.hash}`,
    );

    return;
  }

  const conditionId = fpmm!.conditions[0];
  if (!conditionId) {
    context.log.error(
      `No condition found for FPMM at address ${fpmmAddress} in tx ${event.transaction.hash}`,
    );
    return;
  }
  const condition = await context.Condition.get(conditionId);
  if (!condition) {
    context.log.error(
      `Condition ${conditionId} not found for FPMM at address ${fpmmAddress} in tx ${event.transaction.hash}`,
    );
    return;
  }

  const positionId = condition.positionIds[outcomeIndex];
  if (!positionId) {
    context.log.error(
      `No position found for outcome index ${outcomeIndex} in condition ${conditionId} for FPMM at address ${fpmmAddress} in tx ${event.transaction.hash}`,
    );
    return;
  }

  const price =
    (event.params.investmentAmount * COLLATERAL_SCALE) /
    event.params.outcomeTokensBought;

  updateUserPositionWithBuy(
    context,
    event.params.buyer,
    positionId,
    price,
    event.params.outcomeTokensBought,
  );
}
);

indexer.onEvent(
  { contract: "FixedProductMarketMaker", event: "FPMMSell" },
  async ({ event, context }) => {
  let fpmmAddress = event.srcAddress;
  let fpmm = await context.FixedProductMarketMaker.get(fpmmAddress);
  if (!fpmm) {
    context.log.error(
      `cannot sell: FixedProductMarketMaker instance for ${fpmmAddress} not found`,
    );
    return;
  }

  let oldAmounts = fpmm!.outcomeTokenAmounts;
  let returnAmountPlusFees = event.params.returnAmount + event.params.feeAmount;

  const outcomeIndex = Number(event.params.outcomeIndex);
  let newAmounts = new Array<bigint>(oldAmounts.length);
  let amountsProduct = BigInt(1);

  for (let i = 0; i < oldAmounts.length; i++) {
    const old = oldAmounts[i];
    if (old === undefined) {
      // skip missing entries (or handle as needed)
      continue;
    }
    const value: bigint =
      i === outcomeIndex
        ? old - returnAmountPlusFees + event.params.outcomeTokensSold
        : old - returnAmountPlusFees;

    newAmounts[i] = value;
    amountsProduct *= value;
  }

  fpmm = {
    ...fpmm,
    outcomeTokenAmounts: newAmounts,
    outcomeTokenPrices: calculatePrices(newAmounts),
  };

  let liquidityParameter = nthRoot(amountsProduct, oldAmounts.length, context);
  let collateralScale = getCollateralScale(fpmm!.collateralToken_id, context);
  let collateralScaleDec = BigDecimal(collateralScale.toString());

  fpmm = updateLiquidityFields(fpmm, liquidityParameter, collateralScaleDec);
  fpmm = updateVolumes(
    fpmm,
    event.block.timestamp,
    event.params.returnAmount,
    collateralScaleDec,
    "Sell",
  );

  fpmm = updateFeeFields(fpmm, event.params.feeAmount, collateralScaleDec);

  fpmm = {
    ...fpmm,
    tradesQuantity: increment(fpmm!.tradesQuantity),
    sellsQuantity: increment(fpmm!.sellsQuantity),
  };

  context.FixedProductMarketMaker.set(fpmm);

  // record sell transaction
  context.FpmmTransaction.set({
    id: getEventId(event.transaction.hash, event.logIndex),
    type: "Sell",
    timestamp: event.block.timestamp,
    market_id: event.srcAddress,
    user: event.params.seller,
    tradeAmount: event.params.returnAmount,
    feeAmount: event.params.feeAmount,
    outcomeIndex: BigInt(outcomeIndex),
    outcomeTokensAmount: event.params.outcomeTokensSold,
  });

  // https://github.com/Polymarket/polymarket-subgraph/blob/main/pnl-subgraph/src/FixedProductMarketMakerMapping.ts#L64-L91

  if (event.params.outcomeTokensSold == 0n) {
    context.log.warn(
      `Zero outcome tokens sold in FPMMSell event at tx ${event.transaction.hash}`,
    );

    return;
  }

  const conditionId = fpmm!.conditions[0];
  if (!conditionId) {
    context.log.error(
      `No condition found for FPMM at address ${fpmmAddress} in tx ${event.transaction.hash}`,
    );
    return;
  }
  const condition = await context.Condition.get(conditionId);
  if (!condition) {
    context.log.error(
      `Condition ${conditionId} not found for FPMM at address ${fpmmAddress} in tx ${event.transaction.hash}`,
    );
    return;
  }

  const positionId = condition.positionIds[outcomeIndex];
  if (!positionId) {
    context.log.error(
      `No position found for outcome index ${outcomeIndex} in condition ${conditionId} for FPMM at address ${fpmmAddress} in tx ${event.transaction.hash}`,
    );
    return;
  }

  const price =
    (event.params.returnAmount * COLLATERAL_SCALE) /
    event.params.outcomeTokensSold;

  updateUserPositionWithSell(
    context,
    event.params.seller,
    positionId,
    price,
    event.params.outcomeTokensSold,
  );
}
);

indexer.onEvent(
  { contract: "FixedProductMarketMaker", event: "FPMMFundingRemoved" },
  async ({ event, context }) => {
    let fpmmAddress = event.srcAddress;
    let fpmm = await context.FixedProductMarketMaker.get(fpmmAddress);
    if (!fpmm) {
      context.log.error(
        `cannot remove funding: FixedProductMarketMaker instance for ${fpmmAddress} not found`,
      );
      return;
    }

    let oldAmounts = fpmm!.outcomeTokenAmounts;
    let amountsRemoved = event.params.amountsRemoved;
    let newAmounts = new Array<bigint>(oldAmounts.length);
    let amountsProduct = BigInt(1);

    for (let i = 0; i < oldAmounts.length; i++) {
      const old = oldAmounts[i];
      const oldAmountsRemoved = amountsRemoved[i];
      if (old === undefined || oldAmountsRemoved === undefined) {
        // skip missing entries (or handle as needed)
        continue;
      }
      const value: bigint = old - oldAmountsRemoved;

      newAmounts[i] = value;
      amountsProduct *= value;
    }

    fpmm = {
      ...fpmm,
      outcomeTokenAmounts: newAmounts,
      outcomeTokenPrices: calculatePrices(newAmounts),
    };

    let liquidityParameter = nthRoot(
      amountsProduct,
      oldAmounts.length,
      context,
    );
    let collateralScale = getCollateralScale(fpmm!.collateralToken_id, context);
    let collateralScaleDec = BigDecimal(collateralScale.toString());

    fpmm = updateLiquidityFields(fpmm, liquidityParameter, collateralScaleDec);

    fpmm = {
      ...fpmm,
      totalSupply: fpmm!.totalSupply - event.params.sharesBurnt,
    };

    if (fpmm!.totalSupply === BigInt(0)) {
      fpmm = {
        ...fpmm,
        outcomeTokenPrices: calculatePrices(newAmounts),
      };
    }

    fpmm = {
      ...fpmm,
      liquidityRemoveQuantity: increment(fpmm!.liquidityRemoveQuantity),
    };

    context.FixedProductMarketMaker.set(fpmm);

    // record funding removed transaction
    context.FpmmFundingRemoval.set({
      id: event.transaction.hash,
      timestamp: event.block.timestamp,
      fpmm_id: event.srcAddress,
      funder: event.params.funder,
      amountsRemoved: event.params.amountsRemoved,
      collateralRemoved: event.params.collateralRemovedFromFeePool,
      sharesBurnt: event.params.sharesBurnt,
    });

    const conditionId = fpmm!.conditions[0];
    if (!conditionId) {
      context.log.error(
        `No condition found for FPMM at address ${fpmmAddress} in tx ${event.transaction.hash}`,
      );
      return;
    }
    const condition = await context.Condition.get(conditionId);
    if (!condition) {
      context.log.error(
        `Condition ${conditionId} not found for FPMM at address ${fpmmAddress} in tx ${event.transaction.hash}`,
      );
      return;
    }

    const [a = 0n, b = 0n] = event.params.amountsRemoved ?? [];

    if (a + b === 0n) {
      context.log.warn(
        `Zero funding removed in FPMMFundingRemoved event at tx ${event.transaction.hash}`,
      );
      return;
    }

    let tokenCost = 0n;

    for (let i = 0; i < 2; i++) {
      const positionId = condition.positionIds[i];
      if (!positionId) {
        context.log.error(
          `No position found for outcome index ${i} in condition ${conditionId} for FPMM at address ${fpmmAddress} in tx ${event.transaction.hash}`,
        );
        return;
      }

      const tokenPrice = computeFpmmPrice([a, b], i == 0 ? 0 : 1);
      const tokenAmount = event.params.amountsRemoved?.[i] ?? 0n;
      const tokenCost = (tokenPrice * tokenAmount) / COLLATERAL_SCALE;

      updateUserPositionWithBuy(
        context,
        event.params.funder,
        positionId,
        tokenPrice,
        tokenAmount,
      );
    }

    if (event.params.sharesBurnt == 0n) {
      context.log.warn(
        `Zero shares burnt in FPMMFundingRemoved event at tx ${event.transaction.hash}`,
      );
      return;
    }

    const lpSalePrice =
      ((event.params.collateralRemovedFromFeePool - tokenCost) *
        COLLATERAL_SCALE) /
      event.params.sharesBurnt;

    updateUserPositionWithSell(
      context,
      event.params.funder,
      BigInt(fpmmAddress), // Using FPMM address as positionId for LP shares
      lpSalePrice,
      event.params.sharesBurnt,
    );
  }
);

indexer.onEvent(
  { contract: "FixedProductMarketMaker", event: "FPMMFundingAdded" },
  async ({ event, context }) => {
  let fpmmAddress = event.srcAddress;
  let fpmm = await context.FixedProductMarketMaker.get(fpmmAddress);
  if (!fpmm) {
    context.log.error(
      `cannot add funding: FixedProductMarketMaker instance for ${fpmmAddress} not found`,
    );
    return;
  }

  // let fpmm: DeepMutable<Entity<"FixedProductMarketMaker">> = {
  //   ...entity,
  //   conditions: [...entity.conditions],
  //   outcomeTokenAmounts: [...entity.outcomeTokenAmounts],
  //   outcomeTokenPrices: [...entity.outcomeTokenPrices],
  // };

  let oldAmounts = fpmm!.outcomeTokenAmounts;
  let amountsAdded = event.params.amountsAdded;
  let newAmounts = new Array<bigint>(oldAmounts.length);
  let amountsProduct = BigInt(1);

  for (let i = 0; i < oldAmounts.length; i++) {
    const old = oldAmounts[i];
    const oldAmountsAdded = amountsAdded[i];
    if (old === undefined || oldAmountsAdded === undefined) {
      // skip missing entries (or handle as needed)
      continue;
    }
    const value: bigint = old + oldAmountsAdded;

    newAmounts[i] = value;
    amountsProduct *= value;
  }

  fpmm = {
    ...fpmm,
    outcomeTokenAmounts: newAmounts,
  };

  let liquidityParameter = nthRoot(amountsProduct, oldAmounts.length, context);
  let collateralScale = getCollateralScale(fpmm!.collateralToken_id, context);
  let collateralScaleDec = BigDecimal(collateralScale.toString());
  fpmm = updateLiquidityFields(fpmm, liquidityParameter, collateralScaleDec);

  fpmm = {
    ...fpmm,
    totalSupply: fpmm!.totalSupply + event.params.sharesMinted,
  };

  if (fpmm!.totalSupply === event.params.sharesMinted) {
    fpmm = {
      ...fpmm,
      outcomeTokenPrices: calculatePrices(newAmounts),
    };
  }

  fpmm = {
    ...fpmm,
    liquidityAddQuantity: increment(fpmm!.liquidityAddQuantity),
  };

  context.FixedProductMarketMaker.set(fpmm);

  // record funding added transaction
  let fundingAdditionEntity: FpmmFundingAddition = {
    id: event.transaction.hash,
    timestamp: event.block.timestamp,
    fpmm_id: event.srcAddress,
    funder: event.params.funder,
    amountsAdded: event.params.amountsAdded,
    amountsRefunded: [0n],
    sharesMinted: event.params.sharesMinted,
  };

  let amountsAddedArr = event.params.amountsAdded;
  let addedFunds = max(amountsAddedArr);
  let amountsRefunded = new Array<bigint>(amountsAddedArr.length);
  for (let i = 0; i < amountsAddedArr.length; i++) {
    let x = amountsAddedArr[i];
    if (x === undefined) {
      continue;
    }
    amountsRefunded[i] = addedFunds - x;
  }

  context.FpmmFundingAddition.set({
    ...fundingAdditionEntity,
    amountsRefunded: amountsRefunded,
  });

  // https://github.com/Polymarket/polymarket-subgraph/blob/main/pnl-subgraph/src/FixedProductMarketMakerMapping.ts#L111-L163

  const conditionId = fpmm!.conditions[0];
  if (!conditionId) {
    context.log.error(
      `No condition found for FPMM at address ${fpmmAddress} in tx ${event.transaction.hash}`,
    );
    return;
  }
  const condition = await context.Condition.get(conditionId);
  if (!condition) {
    context.log.error(
      `Condition ${conditionId} not found for FPMM at address ${fpmmAddress} in tx ${event.transaction.hash}`,
    );
    return;
  }

  const [a = 0n, b = 0n] = event.params.amountsAdded ?? [];

  if (a + b === 0n) {
    context.log.warn(
      `Zero funding added in FPMMFundingAdded event at tx ${event.transaction.hash}`,
    );
    return;
  }

  const sendbackDetails = parseFundingAddedSendBack(event);
  const positionId = condition.positionIds[sendbackDetails.outcomeIndex];
  if (!positionId) {
    context.log.error(
      `No position found for outcome index ${sendbackDetails.outcomeIndex} in condition ${conditionId} for FPMM at address ${fpmmAddress} in tx ${event.transaction.hash}`,
    );
    return;
  }

  updateUserPositionWithBuy(
    context,
    event.params.funder,
    positionId,
    sendbackDetails.price,
    sendbackDetails.amount,
  );

  if (event.params.sharesMinted == 0n) {
    context.log.warn(
      `Zero shares minted in FPMMFundingAdded event at tx ${event.transaction.hash}`,
    );
    return;
  }

  const totalUSDCSpend = a > b ? a : b;
  const tokenCost =
    (sendbackDetails.amount * sendbackDetails.price) / COLLATERAL_SCALE;

  const lpShareCost = totalUSDCSpend - tokenCost;
  const lpShareprice =
    (lpShareCost * COLLATERAL_SCALE) / event.params.sharesMinted;

  updateUserPositionWithBuy(
    context,
    event.params.funder,
    BigInt(fpmmAddress), // Using FPMM address as positionId for LP shares
    lpShareprice,
    event.params.sharesMinted,
  );
}
);

indexer.onEvent(
  { contract: "FixedProductMarketMaker", event: "Transfer" },
  async ({ event, context }) => {
  let fpmmAddress = event.srcAddress;
  let fromAddress = event.params.from;
  let toAddress = event.params.to;
  let sharesAmount = event.params.value;

  const zeroAddress = "0x0000000000000000000000000000000000000000";
  try {
    if (fromAddress != zeroAddress) {
      let fromMembership = await context.FpmmPoolMembership.getOrThrow(
        `${fpmmAddress}_${fromAddress}`,
      );
      context.FpmmPoolMembership.set({
        ...fromMembership,
        amount: fromMembership.amount - sharesAmount,
      });
    }
    if (toAddress != zeroAddress) {
      let toMembership = await context.FpmmPoolMembership.getOrThrow(
        `${fpmmAddress}_${toAddress}`,
      );
      context.FpmmPoolMembership.set({
        ...toMembership,
        amount: toMembership.amount + sharesAmount,
      });
    }
  } catch (error) {
    context.log.error(`Error updating FpmmPoolMembership: ${error}`);
  }
}
);
