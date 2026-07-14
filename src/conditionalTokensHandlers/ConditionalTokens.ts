import { indexer } from "envio";
import {
  getOrCreateUserPosition,
  updateOpenInterest,
  updateUserPositionWithBuy,
  updateUserPositionWithSell,
} from "./utils";
import { getEventId } from "../common/utils/getEventId";
import { getPositionId } from "../common/utils/getPositionId";
import { COLLATERAL_SCALE, FIFTY_CENTS } from "./constants";

indexer.onEvent(
  { contract: "ConditionalTokens", event: "PositionSplit" },
  async ({ event, context }) => {
  // check if condition exists if not skip it
  const { amount, collateralToken, conditionId } = event.params;
  const condition = await context.Condition.get(conditionId);

  if (!condition) {
    context.log.error(
      `Failed to find condition while handling PositionSplit: condition ${conditionId} not found`
    );
    return;
  }

  // only track USDC and ignore rest which will be track in neg risk markets
  if (collateralToken == indexer.chains[137].USDC.addresses[0]) {
    // update open interest, this split increases the open interest
    await updateOpenInterest(amount, conditionId, context);
  }

  // https://github.com/Polymarket/polymarket-subgraph/blob/7a92ba026a9466c07381e0d245a323ba23ee8701/activity-subgraph/src/ConditionalTokensMapping.ts#L20-L55
  const stakeholder = event.params.stakeholder;
  const fpmm = await context.FixedProductMarketMaker.get(stakeholder);

  // don't track merges from neg risk adapter and exchange
  // neg risk adpater merges are tracked in it's own handler
  if (
    [
      ...indexer.chains[137].NegRiskAdapter.addresses,
      ...indexer.chains[137].Exchange.addresses,
    ].includes(stakeholder)
  )
    return;

  // https://github.com/Polymarket/polymarket-subgraph/blob/7a92ba026a9466c07381e0d245a323ba23ee8701/pnl-subgraph/src/ConditionalTokensMapping.ts#L25-L56
  // here we update PNL
  for (let i = 0; i < 2; i++) {
    const positionId = condition.positionIds[i];

    if (positionId === undefined) {
      context.log.error(
        `Failed to update user position: positionId for condition ${conditionId} and outcomeIndex ${i} not found`
      );
      continue;
    }

    // update user position with buy
    await updateUserPositionWithBuy(
      context,
      stakeholder,
      positionId,
      FIFTY_CENTS,
      amount
    );
  }

  // don't track merges within the market makers
  if (fpmm != undefined) return;
  // update split entity
  context.Split.set({
    id: getEventId(event.transaction.hash, event.logIndex),
    timestamp: event.block.timestamp,
    stakeholder: stakeholder,
    condition: conditionId,
    amount: event.params.amount,
  });
}
);

indexer.onEvent(
  { contract: "ConditionalTokens", event: "PositionsMerge" },
  async ({ event, context }) => {
  // check if condition exists if not skip it
  const { amount, collateralToken, conditionId } = event.params;
  const condition = await context.Condition.get(conditionId);

  if (!condition) {
    context.log.error(
      `Failed to update market position: condition ${conditionId} not found`
    );
    return;
  }

  // only track USDC and ignore rest which will be track in neg risk markets
  if (collateralToken == indexer.chains[137].USDC.addresses[0]) {
    // update open interest, this merge decreases the open interest
    await updateOpenInterest(-amount, conditionId, context);
  }

  // https://github.com/Polymarket/polymarket-subgraph/blob/7a92ba026a9466c07381e0d245a323ba23ee8701/activity-subgraph/src/ConditionalTokensMapping.ts#L57-L92
  const stakeholder = event.params.stakeholder;
  const fpmm = await context.FixedProductMarketMaker.get(stakeholder);

  // don't track merges from neg risk adapter and exchange
  // neg risk adpater merges are tracked in it's own handler
  if (
    [
      ...indexer.chains[137].NegRiskAdapter.addresses,
      ...indexer.chains[137].Exchange.addresses,
    ].includes(stakeholder)
  )
    return;

  // https://github.com/Polymarket/polymarket-subgraph/blob/7a92ba026a9466c07381e0d245a323ba23ee8701/pnl-subgraph/src/ConditionalTokensMapping.ts#L59-L90
  // update user position with sell
  for (let i = 0; i < 2; i++) {
    const positionId = condition.positionIds[i];

    if (positionId === undefined) {
      context.log.error(
        `Failed to update user position: positionId for condition ${conditionId} and outcomeIndex ${i} not found`
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

  // don't track merges within the market makers
  if (fpmm != undefined) return;
  context.Merge.set({
    id: getEventId(event.transaction.hash, event.logIndex),
    timestamp: event.block.timestamp,
    stakeholder: stakeholder,
    condition: conditionId,
    amount: event.params.amount,
  });
}
);

indexer.onEvent(
  { contract: "ConditionalTokens", event: "PayoutRedemption" },
  async ({ event, context }) => {
  // check if condition exists if not skip it
  const { payout, collateralToken, conditionId, redeemer } = event.params;
  const condition = await context.Condition.get(conditionId);

  if (!condition) {
    context.log.error(
      `Failed to update market position: condition ${conditionId} not found`
    );
    return;
  }
  // only track USDC and ignore rest which will be track in neg risk markets
  if (collateralToken == indexer.chains[137].USDC.addresses[0]) {
    // update open interest, this redemption decreases the open interest
    await updateOpenInterest(-payout, conditionId, context);
  }

  // https://github.com/Polymarket/polymarket-subgraph/blob/7a92ba026a9466c07381e0d245a323ba23ee8701/activity-subgraph/src/ConditionalTokensMapping.ts#L94-L122
  // note: we are checking if condition exists in the starting part of the handler
  if ([...indexer.chains[137].NegRiskAdapter.addresses].includes(redeemer))
    return;

  context.Redemption.set({
    id: getEventId(event.transaction.hash, event.logIndex),
    timestamp: event.block.timestamp,
    redeemer: redeemer,
    condition: conditionId,
    indexSets: event.params.indexSets,
    payout: event.params.payout,
  });

  // https://github.com/Polymarket/polymarket-subgraph/blob/7a92ba026a9466c07381e0d245a323ba23ee8701/pnl-subgraph/src/ConditionalTokensMapping.ts#L111-L140

  const payoutNumerators = condition.payoutNumerators;
  const payoutDenominator = condition.payoutDenominator;

  if (payoutDenominator == 0n) {
    context.log.error(
      `PayoutRedemption Handler Failed: payoutDenominator for condition ${conditionId} is zero`
    );
    return;
  }

  for (let i = 0; i < condition.positionIds.length; i++) {
    const positionId = condition.positionIds[i];

    if (positionId === undefined) {
      context.log.error(
        `Failed to update user position: positionId for condition ${conditionId} and outcomeIndex ${i} not found`
      );
      continue;
    }

    const userPosition = await getOrCreateUserPosition(
      context,
      event.params.redeemer,
      positionId
    );

    const amount = userPosition.amount;
    const payoutNumerator = payoutNumerators[i];
    if (payoutNumerator === undefined) {
      context.log.error(
        `Failed to update user position: payoutNumerator for condition ${conditionId} and outcomeIndex ${i} not found`
      );
      continue;
    }
    const price = (payoutNumerator * COLLATERAL_SCALE) / payoutDenominator;
    updateUserPositionWithSell(context, redeemer, positionId, price, amount);
  }
}
);

// Activity Subgraph: https://github.com/Polymarket/polymarket-subgraph/blob/7a92ba026a9466c07381e0d245a323ba23ee8701/activity-subgraph/src/ConditionalTokensMapping.ts#L124-L154
indexer.onEvent(
  { contract: "ConditionalTokens", event: "ConditionPreparation" },
  async ({ event, context }) => {
  const { outcomeSlotCount, conditionId } = event.params;

  if (outcomeSlotCount != 2n) {
    context.log.warn(
      `ConditionPreparation Handler Warning: condition ${conditionId} has outcomeSlotCount ${outcomeSlotCount}, expected 2`
    );
    return;
  }

  // following part is extra in activity subgraph and not present in Open Interest subgraph
  const negRisk =
    event.params.oracle == indexer.chains[137].NegRiskAdapter.addresses[0];

  const condition = await context.Condition.get(conditionId);
  if (condition == undefined) {
    // PNL subgraph: https://github.com/Polymarket/polymarket-subgraph/blob/main/pnl-subgraph/src/ConditionalTokensMapping.ts#L153-L154
    context.Condition.set({
      id: conditionId,
      positionIds: [
        getPositionId(conditionId as `0x${string}`, 0, negRisk),
        getPositionId(conditionId as `0x${string}`, 1, negRisk),
      ],
      payoutNumerators: [],
      payoutDenominator: 0n,
    });
  }

  for (let i = 0; i < 2; i++) {
    const positionId = getPositionId(
      conditionId as `0x${string}`,
      i,
      negRisk
    ).toString();

    const position = await context.Position.get(positionId);
    if (position == undefined) {
      context.Position.set({
        id: positionId,
        condition: conditionId,
        outcomeIndex: BigInt(i),
      });
    }
  }
}
);

// Only in PNL Subgraph: https://github.com/Polymarket/polymarket-subgraph/blob/main/pnl-subgraph/src/ConditionalTokensMapping.ts#L157-L172
indexer.onEvent(
  { contract: "ConditionalTokens", event: "ConditionResolution" },
  async ({ event, context }) => {
  const { conditionId, payoutNumerators } = event.params;
  const condition = await context.Condition.get(conditionId);

  if (!condition) {
    context.log.error(
      `Failed to update condition on resolution: condition ${conditionId} not found`
    );
    return;
  }

  const payoutDenominator = payoutNumerators.reduce(
    (acc, val) => acc + val,
    0n
  );

  context.Condition.set({
    ...condition,
    payoutNumerators: payoutNumerators,
    payoutDenominator: payoutDenominator,
  });
}
);
