import { indexer, BigDecimal } from "envio";
import type { FixedProductMarketMaker } from "envio";
import { getCollateralDetails } from "./collateralEffect";

indexer.onEvent(
  { contract: "FixedProductMarketMakerFactory", event: "FixedProductMarketMakerCreation" },
  async ({ event, context }) => {
    const {
      fixedProductMarketMaker,
      conditionalTokens,
      creator,
      collateralToken,
      fee,
      conditionIds,
    } = event.params;

    if (
      conditionalTokens !=
      "0x8c8BdBE59c1b3eB0DeC4E634F2C6bBaCa2Cd26B6".toLowerCase()
    ) {
      context.log.info(
        `cannot index market maker ${fixedProductMarketMaker}: using conditional tokens ${conditionalTokens}`,
      );

      return;
    }

    let entity: FixedProductMarketMaker = {
      id: "",
      creator: "",
      creationTimestamp: 0,
      creationTransactionHash: "",
      collateralToken_id: "",
      conditionalTokenAddress: "",
      conditions: [],
      fee: BigInt(0),
      tradesQuantity: BigInt(0),
      buysQuantity: BigInt(0),
      sellsQuantity: BigInt(0),
      liquidityAddQuantity: BigInt(0),
      liquidityRemoveQuantity: BigInt(0),
      collateralVolume: BigInt(0),
      scaledCollateralVolume: BigDecimal(0),
      collateralBuyVolume: BigInt(0),
      scaledCollateralBuyVolume: BigDecimal(0),
      collateralSellVolume: BigInt(0),
      scaledCollateralSellVolume: BigDecimal(0),
      feeVolume: BigInt(0),
      scaledFeeVolume: BigDecimal(0),
      liquidityParameter: BigInt(0),
      scaledLiquidityParameter: BigDecimal(0),
      outcomeTokenAmounts: [],
      outcomeTokenPrices: [],
      outcomeSlotCount: undefined,
      lastActiveDay: 0,
      totalSupply: BigInt(0),
    };

    entity = {
      ...entity,
      id: fixedProductMarketMaker,
      creator: creator,
      creationTimestamp: event.block.timestamp,
      creationTransactionHash: event.transaction.hash,
      conditionalTokenAddress: conditionalTokens,
      collateralToken_id: collateralToken,
      fee: fee,
    };

    // check if collateral token exists if not do an external call to fetch its data
    const collateralTokenEntity = await context.Collateral.get(collateralToken);
    if (!collateralTokenEntity) {
      context.log.info(
        `collateral token ${collateralToken} not found for market maker ${fixedProductMarketMaker}, fetching data...`,
      );
      const metadata: string | TokenDetails = await context.effect(
        getCollateralDetails,
        collateralToken,
      );

      context.Collateral.set({
        id: collateralToken,
        name: metadata.name,
        symbol: metadata.symbol,
        decimals: metadata.decimal,
      });
    }

    for (const conditionId of conditionIds) {
      const conditionEntity = await context.Condition.get(conditionId);
      if (!conditionEntity) {
        context.log.error(`
          failed to create market maker ${fixedProductMarketMaker}: condition ${conditionId} not found
        `);
        return;
      }
    }

    entity = {
      ...entity,
      conditions: conditionIds,
      outcomeSlotCount: conditionIds.length,
    };

    let outcomeTokenAmounts: bigint[] = new Array<bigint>(conditionIds.length);
    outcomeTokenAmounts = outcomeTokenAmounts.fill(0n);

    let outcomeTokenPrices: BigDecimal[] = new Array<BigDecimal>(
      conditionIds.length,
    );
    outcomeTokenPrices = outcomeTokenPrices.fill(BigDecimal(0));

    entity = {
      ...entity,
      outcomeTokenAmounts: outcomeTokenAmounts,
      outcomeTokenPrices: outcomeTokenPrices,
      lastActiveDay: event.block.timestamp / 86400,
    };

    context.FixedProductMarketMaker.set(entity);
  }
);

indexer.contractRegister(
  { contract: "FixedProductMarketMakerFactory", event: "FixedProductMarketMakerCreation" },
  async ({ event, context }) => {
    context.chain.FixedProductMarketMaker.add(event.params.fixedProductMarketMaker);
  }
);

type TokenDetails = {
  name: string;
  symbol: string;
  decimal: number;
};
