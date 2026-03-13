import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { ethers } from "ethers";

const DEFAULT_TRA_CONTRACT_ADDRESS = "0xFBF74694b8450695A382F35448e88bd817fceD26";

const TRA_KYC_ESCROW_ABI = [
  "function previewPayment((address recipient,(string url,string header,string method,string body) request,(string keyName,string parseType,string parsePath)[] reponseResolve,string data,string attConditions,uint64 timestamp,string additionParams,(address attestorAddr,string url)[] attestors,bytes[] signatures) attestation,address payer,uint256 amount) view returns (bool ok, string reason)",
  "function payWithOkxKyc((address recipient,(string url,string header,string method,string body) request,(string keyName,string parseType,string parsePath)[] reponseResolve,string data,string attConditions,uint64 timestamp,string additionParams,(address attestorAddr,string url)[] attestors,bytes[] signatures) attestation,uint256 amount) returns (bool forwarded, string reason)",
];

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
];

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value.trim();
}

function parseCliAmount() {
  const amount = process.argv[2];
  if (!amount || !amount.trim()) {
    throw new Error("Provide amount as argv[2], for example: npm run pay:tra -- 12.5");
  }
  return amount.trim();
}

async function main() {
  const rpcUrl = process.env.SEPOLIA_RPC_URL || getRequiredEnv("RPC_URL");
  const privateKey = getRequiredEnv("PRIVATE_KEY");
  const attestationPath = path.resolve(
    process.cwd(),
    process.env.ATTESTATION_OUTPUT_PATH || "artifacts/okx-account-config-attestation.json",
  );
  const traContractAddress =
    process.env.TRA_CONTRACT_ADDRESS?.trim() || DEFAULT_TRA_CONTRACT_ADDRESS;
  const tokenAddress = getRequiredEnv("TOKEN_ADDRESS");
  const amountInput = parseCliAmount();

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  const attestation = JSON.parse(await fs.readFile(attestationPath, "utf8"));
  const tra = new ethers.Contract(traContractAddress, TRA_KYC_ESCROW_ABI, wallet);
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);

  const decimals = await token.decimals();
  const amount = ethers.parseUnits(amountInput, decimals);

  console.log("Running contract preview");
  const [ok, reason] = await tra.previewPayment(attestation, wallet.address, amount);
  if (!ok) {
    throw new Error(`Attestation rejected by contract preview: ${reason}`);
  }

  const allowance = await token.allowance(wallet.address, traContractAddress);
  if (allowance < amount) {
    console.log("Submitting token approval");
    const approvalTx = await token.approve(traContractAddress, amount);
    console.log(`Approval submitted: ${approvalTx.hash}`);
    await approvalTx.wait();
  }

  console.log("Sending payment transaction");
  const tx = await tra.payWithOkxKyc(attestation, amount);
  console.log(`Payment tx submitted: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`Payment confirmed in block: ${receipt.blockNumber}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
