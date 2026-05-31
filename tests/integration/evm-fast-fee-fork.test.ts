import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  formatUnits,
  http,
  isAddress,
  parseAbi,
  parseAbiItem,
  parseEther,
  type Address,
  type Chain,
  type PublicClient,
  type TestClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum, mainnet } from "viem/chains";
import {
  buildApprovalData,
  buildBridgeWithPreapprovalData,
} from "@/lib/cctp/evm/burn";
import { formatMintRecipientHex, ZERO_BYTES32 } from "@/lib/cctp/shared";

const BRIDGE_CONTRACT: Address = "0xB3FA262d0fB521cc93bE83d87b322b8A23DAf3F0";
const TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const DEFAULT_FEE_RECIPIENT: Address = "0x1111111111111111111111111111111111111111";
const USDC_TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);
const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

type ForkCase = {
  name: string;
  chain: Chain;
  rpcUrl: string | undefined;
  usdc: Address;
  destinationDomain: number;
};

const forkCases: ForkCase[] = [
  {
    name: "Ethereum mainnet",
    chain: mainnet,
    rpcUrl: process.env.EVM_FORK_ETH_RPC_URL,
    usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as Address,
    destinationDomain: 3,
  },
  {
    name: "Arbitrum mainnet",
    chain: arbitrum,
    rpcUrl: process.env.EVM_FORK_ARB_RPC_URL,
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as Address,
    destinationDomain: 0,
  },
].filter((forkCase) => Boolean(forkCase.rpcUrl));

const describeIfForkConfigured = forkCases.length > 0 ? describe : describe.skip;

async function getOpenPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
          return;
        }
        reject(new Error("Unable to allocate test port"));
      });
    });
  });
}

async function waitForAnvil(url: string, chain: Chain): Promise<void> {
  const client = createPublicClient({ chain, transport: http(url) });
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < 30_000) {
    try {
      await client.getBlockNumber();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error(`Timed out waiting for anvil fork: ${String(lastError)}`);
}

async function startAnvilFork(
  forkCase: ForkCase
): Promise<{ process: ChildProcessWithoutNullStreams; url: string }> {
  const port = await getOpenPort();
  const url = `http://127.0.0.1:${port}`;
  const process = spawn(
    "anvil",
    ["--fork-url", forkCase.rpcUrl!, "--port", String(port), "--silent"],
    { stdio: "pipe" }
  );

  process.once("error", (error) => {
    throw error;
  });

  await waitForAnvil(url, forkCase.chain);
  return { process, url };
}

async function stopAnvilFork(process: ChildProcessWithoutNullStreams | null) {
  if (!process || process.killed) return;
  process.kill("SIGTERM");
  await new Promise((resolve) => process.once("close", resolve));
}

async function readUsdcBalance(
  client: PublicClient,
  token: Address,
  owner: Address
): Promise<bigint> {
  return client.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [owner],
  });
}

async function findRecentUsdcHolder(params: {
  client: PublicClient;
  token: Address;
  minimumBalance: bigint;
}): Promise<Address> {
  const latestBlock = await params.client.getBlockNumber();
  const chunkSize = 100n;
  const maxDepth = 50_000n;

  for (let searched = 0n; searched < maxDepth; searched += chunkSize) {
    const toBlock = latestBlock - searched;
    const fromBlock = toBlock > chunkSize ? toBlock - chunkSize : 0n;
    let logs;
    try {
      logs = await params.client.getLogs({
        address: params.token,
        event: USDC_TRANSFER_EVENT,
        fromBlock,
        toBlock,
      });
    } catch {
      continue;
    }

    for (const log of logs.reverse()) {
      const candidate = log.args.to;
      if (!candidate || candidate === "0x0000000000000000000000000000000000000000") {
        continue;
      }

      const balance = await readUsdcBalance(params.client, params.token, candidate);
      if (balance >= params.minimumBalance) {
        return candidate;
      }
    }
  }

  throw new Error(
    `Could not find a recent USDC holder with at least ${formatUnits(params.minimumBalance, 6)} USDC`
  );
}

async function seedUsdcFromHolder(params: {
  publicClient: PublicClient;
  testClient: TestClient<"anvil">;
  forkCase: ForkCase;
  localUrl: string;
  recipient: Address;
  amount: bigint;
}) {
  const holder = await findRecentUsdcHolder({
    client: params.publicClient,
    token: params.forkCase.usdc,
    minimumBalance: params.amount,
  });

  await params.testClient.setBalance({
    address: holder,
    value: parseEther("10"),
  });
  await params.testClient.impersonateAccount({ address: holder });

  const holderWallet = createWalletClient({
    chain: params.forkCase.chain,
    transport: http(params.localUrl),
    account: holder,
  });
  const transferHash = await holderWallet.writeContract({
    address: params.forkCase.usdc,
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [params.recipient, params.amount],
  });
  await params.publicClient.waitForTransactionReceipt({ hash: transferHash });

  await params.testClient.stopImpersonatingAccount({ address: holder });
}

describeIfForkConfigured("EVM fast fee bridge fork tests", () => {
  let anvilProcess: ChildProcessWithoutNullStreams | null = null;

  afterEach(async () => {
    await stopAnvilFork(anvilProcess);
    anvilProcess = null;
  });

  it.each(forkCases)(
    "$name executes bridgeWithPreapproval and routes 90% of app fee to recipient",
    async (forkCase) => {
      const fork = await startAnvilFork(forkCase);
      anvilProcess = fork.process;

      const publicClient = createPublicClient({
        chain: forkCase.chain,
        transport: http(fork.url),
      });
      const testClient = createTestClient({
        chain: forkCase.chain,
        mode: "anvil",
        transport: http(fork.url),
      });
      const account = privateKeyToAccount(TEST_PRIVATE_KEY);
      const walletClient = createWalletClient({
        chain: forkCase.chain,
        transport: http(fork.url),
        account,
      });
      const configuredFeeRecipient = process.env.NEXT_PUBLIC_FEE_ADDRESS_EVM;
      const feeRecipient = configuredFeeRecipient && isAddress(configuredFeeRecipient)
        ? configuredFeeRecipient
        : DEFAULT_FEE_RECIPIENT;
      const feeBps = Number(process.env.NEXT_PUBLIC_FAST_TX_FEE_BPS ?? "4");
      const inputAmount = 10_000_000n;
      const appFee = (inputAmount * BigInt(feeBps) + 9_999n) / 10_000n;
      const bridgeAmount = inputAmount - appFee;
      const expectedRecipientFee = (appFee * 90n) / 100n;

      await testClient.setBalance({
        address: account.address,
        value: parseEther("10"),
      });
      await seedUsdcFromHolder({
        publicClient,
        testClient,
        forkCase,
        localUrl: fork.url,
        recipient: account.address,
        amount: inputAmount,
      });

      const userBalanceBefore = await readUsdcBalance(
        publicClient,
        forkCase.usdc,
        account.address
      );
      const recipientBalanceBefore = await readUsdcBalance(
        publicClient,
        forkCase.usdc,
        feeRecipient
      );

      const approvalData = buildApprovalData(
        forkCase.usdc,
        BRIDGE_CONTRACT,
        inputAmount
      );
      const approvalHash = await walletClient.sendTransaction({
        to: approvalData.to,
        data: approvalData.data,
      });
      await publicClient.waitForTransactionReceipt({ hash: approvalHash });

      const bridgeData = buildBridgeWithPreapprovalData(BRIDGE_CONTRACT, {
        amount: bridgeAmount,
        maxFee: 1n,
        fee: appFee,
        mintRecipient: formatMintRecipientHex(account.address, forkCase.chain.id),
        destinationCaller: ZERO_BYTES32,
        burnToken: forkCase.usdc,
        feeRecipient,
        destinationDomain: forkCase.destinationDomain,
        minFinalityThreshold: 1000,
      });
      const bridgeHash = await walletClient.sendTransaction({
        to: bridgeData.to,
        data: bridgeData.data,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: bridgeHash });

      const userBalanceAfter = await readUsdcBalance(
        publicClient,
        forkCase.usdc,
        account.address
      );
      const recipientBalanceAfter = await readUsdcBalance(
        publicClient,
        forkCase.usdc,
        feeRecipient
      );

      expect(receipt.status).toBe("success");
      expect(userBalanceBefore - userBalanceAfter).toBe(inputAmount);
      expect(recipientBalanceAfter - recipientBalanceBefore).toBe(expectedRecipientFee);
    },
    120_000
  );
});
