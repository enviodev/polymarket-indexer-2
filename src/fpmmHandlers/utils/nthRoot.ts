import type { EvmOnEventContext } from "envio";

export function nthRoot(x: bigint, n: number, context: EvmOnEventContext): bigint {
  if (n <= 0) {
    context.log.error(`invalid n ${n} passed to nthRoot`);
  }

  if (x == 0n) {
    return 0n;
  }

  let nAsBigInt = BigInt(n);

  let root = x;
  let deltaRoot: bigint;

  do {
    let rootPowNLess1 = 1n;
    for (let i = 1; i < n - 1; i++) {
      rootPowNLess1 *= root;
    }

    deltaRoot = (x / rootPowNLess1 - root) / nAsBigInt;
    root += deltaRoot;
  } while (deltaRoot < 0n);

  return root;
}
