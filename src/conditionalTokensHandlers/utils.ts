import { indexer } from "envio";
import type { EvmOnEventContext } from "envio";
import { COLLATERAL_SCALE, GLOBAL_OPEN_INTEREST_ID } from "./constants";
import { hexToBytes, bytesToHex, keccak256 } from "viem";
import { computePositionId } from "../common/utils/ctf-util";

export async function updateMarketOpenInterest(
  amount: bigint,
  conditionId: string,
  context: EvmOnEventContext
) {
  let marketOpenInterest = await context.MarketOpenInterest.getOrCreate({
    id: conditionId,
    amount: 0n,
  });

  marketOpenInterest = {
    ...marketOpenInterest,
    amount: marketOpenInterest.amount + amount,
  };

  context.MarketOpenInterest.set(marketOpenInterest);
}

export async function updateGlobalOpenInterest(
  amount: bigint,
  context: EvmOnEventContext
) {
  let globalOpenInterest = await context.GlobalOpenInterest.getOrCreate({
    id: GLOBAL_OPEN_INTEREST_ID,
    amount: 0n,
  });

  globalOpenInterest = {
    ...globalOpenInterest,
    amount: globalOpenInterest.amount + amount,
  };

  context.GlobalOpenInterest.set(globalOpenInterest);
}

export async function updateOpenInterest(
  amount: bigint,
  conditionId: string,
  context: EvmOnEventContext
) {
  await Promise.all([
    updateGlobalOpenInterest(amount, context),
    updateMarketOpenInterest(amount, conditionId, context),
  ]);
}

export function getNegRiskQuestionId(
  marketId: `0x${string}`, // bytes32
  questionIndex: number // u8
): `0x${string}` {
  if (questionIndex < 0 || questionIndex > 255) {
    throw new Error("questionIndex must be 0–255");
  }

  const bytes = hexToBytes(marketId);
  if (bytes.length !== 32) {
    throw new Error("marketId must be 32 bytes");
  }

  // overwrite last byte
  bytes[31] = questionIndex;

  return bytesToHex(bytes);
}

export function getConditionId(
  oracle: `0x${string}`, // address
  questionId: `0x${string}` // bytes32
): `0x${string}` {
  const oracleBytes = hexToBytes(oracle);
  const questionBytes = hexToBytes(questionId);

  if (oracleBytes.length !== 20) {
    throw new Error("oracle must be 20 bytes");
  }
  if (questionBytes.length !== 32) {
    throw new Error("questionId must be 32 bytes");
  }

  // 20 + 32 + 32 = 84 bytes
  const payload = new Uint8Array(84);
  payload.fill(0);

  // oracle → bytes [0..19]
  payload.set(oracleBytes, 0);

  // questionId → bytes [20..51]
  payload.set(questionBytes, 20);

  // outcomeSlotCount = 2 (last byte)
  payload[83] = 0x02;

  return keccak256(payload);
}

export function getNegRiskConditionId(
  negRiskMarketId: `0x${string}`,
  questionIndex: number
) {
  if (questionIndex < 0 || questionIndex > 255) {
    throw new Error("questionIndex must be 0–255");
  }

  const questionId = getNegRiskQuestionId(negRiskMarketId, questionIndex);
  const conditionId = getConditionId(
    "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296", // NegRiskAdapter address from config.yaml is pasted here
    questionId
  );

  return conditionId;
}

export function indexSetContains(
  indexSet: bigint,
  index: number // u8
): boolean {
  if (index < 0 || index > 255) {
    throw new Error("index must be 0–255");
  }

  return (indexSet & (1n << BigInt(index))) !== 0n;
}

export async function getOrCreateUserPosition(
  context: EvmOnEventContext,
  user: `0x${string}`,
  positionId: bigint
) {
  return await context.UserPosition.getOrCreate({
    id: `${user}-${positionId.toString()}`,
    user: user,
    tokenId: positionId,
    avgPrice: 0n,
    amount: 0n,
    realizedPnl: 0n,
    totalBought: 0n,
  });
}

export async function updateUserPositionWithBuy(
  context: EvmOnEventContext,
  user: `0x${string}`,
  positionId: bigint,
  price: bigint,
  amount: bigint
) {
  const userPosition = await getOrCreateUserPosition(context, user, positionId);

  if (amount > 0n) {
    const numerator =
      userPosition.avgPrice * userPosition.amount + price * amount;
    const denominator = userPosition.amount + amount;

    context.UserPosition.set({
      ...userPosition,
      avgPrice: numerator / denominator,
      amount: userPosition.amount + amount,
      totalBought: userPosition.totalBought + amount,
    });
  }
}

export async function updateUserPositionWithSell(
  context: EvmOnEventContext,
  user: `0x${string}`,
  positionId: bigint,
  price: bigint,
  amount: bigint
) {
  const userPosition = await getOrCreateUserPosition(context, user, positionId);

  const adjustedAmount =
    amount > userPosition.amount ? userPosition.amount : amount;

  const deltaPnl =
    (adjustedAmount * (price - userPosition.avgPrice)) / COLLATERAL_SCALE;

  context.UserPosition.set({
    ...userPosition,
    amount: userPosition.amount - adjustedAmount,
    realizedPnl: userPosition.realizedPnl + deltaPnl,
  });
}

export const getNegRiskPositionId = (
  context: EvmOnEventContext,
  negRiskMarketId: `0x${string}`,
  questionIndex: number,
  outcomeIndex: number
): bigint => {
  const questionId = getNegRiskQuestionId(negRiskMarketId, questionIndex);
  const NEG_RSIK_ADAPTER_ADDRESS =
    indexer.chains[137].NegRiskAdapter.addresses[0];
  if (!NEG_RSIK_ADAPTER_ADDRESS) {
    context.log.error(`
      NegRiskAdapter address not found in config for chain 137`);
    throw new Error("NegRiskAdapter address not found in config");
  }
  const conditionId = getConditionId(NEG_RSIK_ADAPTER_ADDRESS, questionId);

  const positionId = computePositionId(
    NEG_RSIK_ADAPTER_ADDRESS,
    conditionId,
    outcomeIndex
  );
  return positionId;
};

export const computeNegRiskYesPrice = (
  noPrice: bigint,
  noCount: number,
  questionCount: number
): bigint => {
  const yesPrice =
    (noPrice * BigInt(noCount) - COLLATERAL_SCALE * BigInt(noCount - 1)) /
    BigInt(questionCount - noCount);

  return yesPrice;
};
