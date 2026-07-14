import { indexer } from "envio";
import { computePositionId } from "./ctf-util";

const NEG_RISK_WRAPPED_COLLATERAL: `0x${string}` =
  "0x3A3BD7bb9528E159577F7C2e685CC81A765002E2";

const getPositionId = (
  conditionId: `0x${string}`,
  outcomeIndex: number,
  negRisk: boolean
): bigint => {
  const collateral: `0x${string}` = negRisk
    ? NEG_RISK_WRAPPED_COLLATERAL
    : indexer.chains[137].USDC.addresses[0]!;

  return computePositionId(collateral, conditionId, outcomeIndex);
};

export { getPositionId };
