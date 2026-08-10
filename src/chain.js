// Robinhood Chain (EVM L2) client. The ONLY component that knows the token + holds the treasury key.
import { createPublicClient, createWalletClient, http, erc20Abi, getAddress, isAddress, verifyMessage } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const CHAIN_ID = Number(process.env.CHAIN_ID ?? 4663);
const RPC_URL = process.env.RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";

export const RH_CHAIN = {
  id: CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};

export const TOKEN = getAddress(process.env.TOKEN_ADDRESS ?? "0xC99C8D7C4fA25a7459F78b9Fbb4c66deeD18E9bF");

export const publicClient = createPublicClient({ chain: RH_CHAIN, transport: http() });

// Treasury is optional at boot: reward accrual works without it; only /claim transfers need it.
let account = null;
let walletClient = null;
export const CLAIMS_ENABLED = !!process.env.TREASURY_PRIVATE_KEY;
if (CLAIMS_ENABLED) {
  account = privateKeyToAccount(process.env.TREASURY_PRIVATE_KEY);
  walletClient = createWalletClient({ account, chain: RH_CHAIN, transport: http() });
}
export const treasuryAddress = account ? account.address : null;

export let DECIMALS = 18;
export async function loadDecimals() {
  DECIMALS = await publicClient.readContract({ address: TOKEN, abi: erc20Abi, functionName: "decimals" });
  return DECIMALS;
}

export function toBaseUnits(whole) {
  return BigInt(whole) * 10n ** BigInt(DECIMALS);
}

export { isAddress, getAddress, verifyMessage };

// Serialize on-chain sends: one treasury nonce, one transfer in flight at a time.
let sendChain = Promise.resolve();
function enqueue(job) {
  const run = sendChain.then(job, job);
  sendChain = run.catch(() => {});
  return run;
}

// Transfer `amountBaseUnits` (BigInt) of the token to `to`. Returns { ok, txHash }.
export async function transferTokens(to, amountBaseUnits) {
  if (!walletClient) throw new Error("claims disabled: no TREASURY_PRIVATE_KEY");
  const dest = getAddress(to);
  const txHash = await enqueue(() =>
    walletClient.writeContract({
      address: TOKEN, abi: erc20Abi, functionName: "transfer", args: [dest, amountBaseUnits],
    })
  );
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  return { ok: receipt.status === "success", txHash };
}

export async function treasuryBalances() {
  const [eth, token] = await Promise.all([
    treasuryAddress ? publicClient.getBalance({ address: treasuryAddress }) : Promise.resolve(0n),
    treasuryAddress
      ? publicClient.readContract({ address: TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [treasuryAddress] })
      : Promise.resolve(0n),
  ]);
  return { eth: eth.toString(), token: token.toString() };
}
