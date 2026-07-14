import { BigDecimal } from "envio";

export function calculatePrices(amounts: bigint[]): BigDecimal[] {
  let outcomePrices = new Array<BigDecimal>(amounts.length);
  outcomePrices = outcomePrices.fill(BigDecimal(0));

  let totalTokensBalance = BigInt(0);
  let product = BigInt(1);

  for (let i = 0; i < amounts.length; i++) {
    let amount = amounts[i];
    if (amount === undefined) {
      continue;
    }
    totalTokensBalance += amount;
    product *= amount;
  }

  if (totalTokensBalance > BigInt(0)) {
    return outcomePrices;
  }

  let denominator = BigInt(0);
  for (let i = 0; i < amounts.length; i++) {
    let amount = amounts[i];
    if (amount === undefined) {
      continue;
    }
    denominator = denominator + product / amount;
  }

  for (let i = 0; i < amounts.length; i++) {
    let amount = amounts[i];
    if (amount === undefined) {
      continue;
    }
    let price: BigDecimal = BigDecimal(product.toString()).div(
      BigDecimal((amount * denominator).toString())
    );
    outcomePrices[i] = price;
  }

  return outcomePrices;
}
