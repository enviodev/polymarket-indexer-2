import type { EvmOnEventContext } from "envio";

export async function getCollateralScale(
  collateralTokenId: string,
  context: EvmOnEventContext,
): Promise<bigint> {
  const collateral = await context.Collateral.get(collateralTokenId);

  if (!collateral) {
    context.log.error(
      `collateral token ${collateralTokenId} not found, defaulting scale to 1e18`,
    );
    return 10n ** 18n;
  }

  return 10n ** BigInt(collateral.decimals);
}
