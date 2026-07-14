import { indexer } from "envio";
import {
  computeNegRiskYesPrice,
  getNegRiskConditionId,
  getNegRiskPositionId,
  getOrCreateUserPosition,
  indexSetContains,
  updateGlobalOpenInterest,
  updateMarketOpenInterest,
  updateOpenInterest,
  updateUserPositionWithBuy,
  updateUserPositionWithSell,
} from "./utils";
import { getEventId } from "../common/utils/getEventId";
import { COLLATERAL_SCALE, FIFTY_CENTS } from "./constants";

/**
 * @dev following event handlers combined logic from both activity and oi subgraphs for NegRiskAdapter
 */

indexer.onEvent(
  { contract: "NegRiskAdapter", event: "PositionSplit" },
  async ({ event, context }) => {
  const { amount, conditionId, stakeholder } = event.params;
  let isInternalSplit = true;
  let conditionFound = true;

  // https://github.com/Polymarket/polymarket-subgraph/blob/7a92ba026a9466c07381e0d245a323ba23ee8701/activity-subgraph/src/NegRiskAdapterMapping.ts#L21
  // track splits for all addresses except for NegRiskAdapter
  if (
    ![...indexer.chains[137].NegRiskAdapter.addresses].includes(stakeholder)
  ) {
    // activity subgraph
    // executes if not an internal split
    isInternalSplit = false;
    context.Split.set({
      id: getEventId(event.transaction.hash, event.logIndex),
      timestamp: event.block.timestamp,
      stakeholder: stakeholder,
      condition: conditionId,
      amount: amount,
    });
  }

  // https://github.com/Polymarket/polymarket-subgraph/blob/7a92ba026a9466c07381e0d245a323ba23ee8701/oi-subgraph/src/NegRiskAdapterMapping.ts#L24-L32
  // check if condition exists if not skip updating open interest
  const condition = await context.Condition.get(conditionId);
  if (condition) {
    // oi subgraph
    // split increases the open interest
    await updateOpenInterest(amount, conditionId, context);
  } else {
    conditionFound = false;
  }

  // PNL subgraph: https://github.com/Polymarket/polymarket-subgraph/blob/main/pnl-subgraph/src/NegRiskAdapterMapping.ts#L49-L60
  if (!isInternalSplit && conditionFound) {
    // pnl subgraph
    for (let i = 0; i < 2; i++) {
      const positionId = condition?.positionIds[i];
      if (positionId == undefined) {
        context.log.warn(
          `NegRiskAdapter.PositionSplit: Missing positionId for conditionId ${conditionId} at index ${i}`
        );
        continue;
      }
      await updateUserPositionWithBuy(
        context,
        stakeholder,
        positionId,
        FIFTY_CENTS,
        amount
      );
    }
  }
}
);

indexer.onEvent(
  { contract: "NegRiskAdapter", event: "PositionsMerge" },
  async ({ event, context }) => {
  const { amount, conditionId, stakeholder } = event.params;

  let conditionExists = true;
  let isInternalMerge = true;
  // https://github.com/Polymarket/polymarket-subgraph/blob/7a92ba026a9466c07381e0d245a323ba23ee8701/activity-subgraph/src/NegRiskAdapterMapping.ts#L39
  // track merges for all addresses except for NegRiskAdapter
  if (
    ![...indexer.chains[137].NegRiskAdapter.addresses].includes(stakeholder)
  ) {
    // activity subgraph
    // executes if not an internal merge
    isInternalMerge = false;
    context.Merge.set({
      id: getEventId(event.transaction.hash, event.logIndex),
      timestamp: event.block.timestamp,
      stakeholder: stakeholder,
      condition: conditionId,
      amount: amount,
    });
  }

  // https://github.com/Polymarket/polymarket-subgraph/blob/7a92ba026a9466c07381e0d245a323ba23ee8701/oi-subgraph/src/NegRiskAdapterMapping.ts#L39C1-L45C43
  // update open interest only if condition exists
  const condition = await context.Condition.get(conditionId);
  if (condition) {
    // merge decreases the open interest
    await updateOpenInterest(-amount, conditionId, context);
  } else {
    conditionExists = false;
  }

  // PNL subgraph: https://github.com/Polymarket/polymarket-subgraph/blob/main/pnl-subgraph/src/NegRiskAdapterMapping.ts#L81-L92
  if (!isInternalMerge && conditionExists) {
    // pnl subgraph
    for (let i = 0; i < 2; i++) {
      const positionId = condition?.positionIds[i];
      if (positionId == undefined) {
        context.log.warn(
          `NegRiskAdapter.PositionsMerge: Missing positionId for conditionId ${conditionId} at index ${i}`
        );
        continue;
      }
      await updateUserPositionWithSell(
        context,
        stakeholder,
        positionId,
        FIFTY_CENTS,
        amount
      );
    }
  }
}
);

indexer.onEvent(
  { contract: "NegRiskAdapter", event: "PayoutRedemption" },
  async ({ event, context }) => {
  const { payout, conditionId, redeemer } = event.params;

  // https://github.com/Polymarket/polymarket-subgraph/blob/7a92ba026a9466c07381e0d245a323ba23ee8701/activity-subgraph/src/NegRiskAdapterMapping.ts#L74C1-L81C1
  context.Redemption.set({
    id: getEventId(event.transaction.hash, event.logIndex),
    timestamp: event.block.timestamp,
    redeemer: redeemer,
    condition: conditionId,
    // need to figureout why indexSets is hardcoded to [1,2]
    indexSets: [1n, 2n],
    payout: payout,
  });

  // https://github.com/Polymarket/polymarket-subgraph/blob/7a92ba026a9466c07381e0d245a323ba23ee8701/oi-subgraph/src/NegRiskAdapterMapping.ts#L50C1-L59C43
  const condition = await context.Condition.get(conditionId);

  if (!condition) return;

  // update open interest, this redemption decreases the open interest
  await updateOpenInterest(-payout, conditionId, context);

  // https://github.com/Polymarket/polymarket-subgraph/blob/main/pnl-subgraph/src/NegRiskAdapterMapping.ts#L188-L210

  if (condition.payoutDenominator === 0n) {
    context.log.warn(
      `NegRiskAdapter.PayoutRedemption: Payout denominator is zero for conditionId ${conditionId}`
    );
    return;
  }

  for (let i = 0; i < 2; i++) {
    const positionId = condition.positionIds[i];
    if (positionId == undefined) {
      context.log.warn(
        `NegRiskAdapter.PayoutRedemption: Missing positionId for conditionId ${conditionId} at index ${i}`
      );
      continue;
    }

    const amount = event.params.amounts[i];
    if (!amount) {
      context.log.warn(
        `NegRiskAdapter.PayoutRedemption: Missing amount for positionId ${positionId} at index ${i}`
      );
      continue;
    }

    const positionNumerator = condition.payoutNumerators[i];
    if (!positionNumerator) {
      context.log.warn(
        `NegRiskAdapter.PayoutRedemption: Missing payout numerator for positionId ${positionId} at index ${i}`
      );
      continue;
    }

    const price =
      (positionNumerator * COLLATERAL_SCALE) / condition.payoutDenominator;

    await updateUserPositionWithSell(
      context,
      redeemer,
      positionId,
      price,
      amount
    );
  }
}
);

// activity subgraph permalink: https://github.com/Polymarket/polymarket-subgraph/blob/7a92ba026a9466c07381e0d245a323ba23ee8701/activity-subgraph/src/NegRiskAdapterMapping.ts#L83-L87
// oi-subgraph permalink: https://github.com/Polymarket/polymarket-subgraph/blob/7a92ba026a9466c07381e0d245a323ba23ee8701/oi-subgraph/src/NegRiskAdapterMapping.ts#L125C1-L130C2
indexer.onEvent(
  { contract: "NegRiskAdapter", event: "MarketPrepared" },
  async ({ event, context }) => {
  context.NegRiskEvent.set({
    id: event.params.marketId,
    questionCount: 0,
    feeBps: event.params.feeBips,
  });
}
);

// activity subgraph permalink: https://github.com/Polymarket/polymarket-subgraph/blob/7a92ba026a9466c07381e0d245a323ba23ee8701/activity-subgraph/src/NegRiskAdapterMapping.ts#L89-L98
// oi-subgraph permalink: https://github.com/Polymarket/polymarket-subgraph/blob/7a92ba026a9466c07381e0d245a323ba23ee8701/oi-subgraph/src/NegRiskAdapterMapping.ts#L132C1-L140C2
// pnl subgraph permalink: https://github.com/Polymarket/polymarket-subgraph/blob/main/pnl-subgraph/src/NegRiskAdapterMapping.ts#L222-L230
indexer.onEvent(
  { contract: "NegRiskAdapter", event: "QuestionPrepared" },
  async ({ event, context }) => {
  const negRiskEvent = await context.NegRiskEvent.get(event.params.marketId);
  if (!negRiskEvent) return;

  context.NegRiskEvent.set({
    ...negRiskEvent,
    questionCount: negRiskEvent.questionCount + 1,
  });
}
);

indexer.onEvent(
  { contract: "NegRiskAdapter", event: "PositionsConverted" },
  async ({ event, context }) => {
  const { marketId, indexSet, amount, stakeholder } = event.params;

  const negRiskEvent = await context.NegRiskEvent.get(marketId);
  if (!negRiskEvent) return;

  // https://github.com/Polymarket/polymarket-subgraph/blob/7a92ba026a9466c07381e0d245a323ba23ee8701/activity-subgraph/src/NegRiskAdapterMapping.ts#L57
  context.NegRiskConversion.set({
    id: getEventId(event.transaction.hash, event.logIndex),
    timestamp: event.block.timestamp,
    stakeholder: stakeholder,
    negRiskMarketId: marketId,
    amount: amount,
    indexSet: indexSet,
    questionCount: negRiskEvent.questionCount,
  });

  //https://github.com/Polymarket/polymarket-subgraph/blob/7a92ba026a9466c07381e0d245a323ba23ee8701/oi-subgraph/src/NegRiskAdapterMapping.ts#L69C1-L123C1

  const questionCount = negRiskEvent.questionCount;

  let conditionIds: string[] = [];

  // pnl related variables
  let noCountPNL = 0;
  let noPriceSumPNL = 0n;

  for (let i = 0; i < questionCount; i++) {
    if (indexSetContains(indexSet, i)) {
      conditionIds.push(getNegRiskConditionId(marketId as `0x${string}`, i));

      // https://github.com/Polymarket/polymarket-subgraph/blob/main/pnl-subgraph/src/NegRiskAdapterMapping.ts#L121-L144

      noCountPNL += 1;

      const positionId = getNegRiskPositionId(
        context,
        marketId as `0x${string}`,
        i,
        1 // NO_INDEX
      );

      const userPosition = await getOrCreateUserPosition(
        context,
        stakeholder,
        positionId
      );

      await updateUserPositionWithSell(
        context,
        stakeholder,
        positionId,
        userPosition.avgPrice,
        amount
      );

      noPriceSumPNL += userPosition.avgPrice;
    }
  }

  let noCount = conditionIds.length;
  if (noCount > 1) {
    let amount = event.params.amount;
    let feeAmount = 0n;
    let multiplier = BigInt(noCount - 1);
    let divisor = BigInt(noCount);

    if (negRiskEvent.feeBps > 0) {
      feeAmount = (amount * BigInt(negRiskEvent.feeBps)) / 10_000n;
      amount -= feeAmount;

      let feeReleasedToVault = -(feeAmount * multiplier);
      for (let i = 0; i < noCount; i++) {
        let conditionId = conditionIds[i];
        if (conditionId != undefined) {
          await updateMarketOpenInterest(
            feeReleasedToVault / divisor,
            conditionId,
            context
          );
        } else {
          context.log.error(
            `NegRiskAdapter.PositionsConverted: Missing conditionId for marketId ${marketId} at index ${i}`
          );
        }
      }

      await updateGlobalOpenInterest(feeAmount, context);
    }

    let collateralReleasedToUser = -(amount * multiplier);
    for (let i = 0; i < noCount; i++) {
      let conditionId = conditionIds[i];
      if (conditionId != undefined) {
        await updateMarketOpenInterest(
          collateralReleasedToUser / divisor,
          conditionId,
          context
        );
      } else {
        context.log.error(
          `NegRiskAdapter.PositionsConverted: Missing conditionId for marketId ${marketId} at index ${i}`
        );
      }
    }
    await updateGlobalOpenInterest(collateralReleasedToUser, context);
  }

  // https://github.com/Polymarket/polymarket-subgraph/blob/main/pnl-subgraph/src/NegRiskAdapterMapping.ts#L148-L176

  const noPrice = noPriceSumPNL / BigInt(noCountPNL);

  // questionCount could equal noCount,
  // in that case we didn't buy any YES tokens
  if (questionCount == noCountPNL) {
    return;
  }

  const yesPrice = computeNegRiskYesPrice(noPrice, noCountPNL, questionCount);

  for (let i = 0; i < questionCount; i++) {
    if (!indexSetContains(indexSet, i)) {
      const positionId = getNegRiskPositionId(
        context,
        marketId as `0x${string}`,
        i,
        0 // YES_INDEX
      );
      updateUserPositionWithBuy(
        context,
        stakeholder,
        positionId,
        yesPrice,
        amount
      );
    }
  }
}
);
