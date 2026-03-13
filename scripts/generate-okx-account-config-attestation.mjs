import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ethers } from "ethers";
import { PrimusCoreTLS } from "@primuslabs/zktls-core-sdk";

const OKX_BASE_URL = "https://www.okx.com";
const OKX_ACCOUNT_CONFIG_PATH = "/api/v5/account/config";
const OKX_ACCOUNT_CONFIG_URL = `${OKX_BASE_URL}${OKX_ACCOUNT_CONFIG_PATH}`;
const ERC20_ABI = ["function decimals() view returns (uint8)"];

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value.trim();
}

function signOkxRequest({ secret, timestamp, method, requestPath, body = "" }) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}${method}${requestPath}${body}`)
    .digest("base64");
}

function parseCliAmount() {
  const amount = process.argv[2];
  if (!amount || !amount.trim()) {
    throw new Error("Provide amount as argv[2], for example: npm run attest:okx:config -- 12.5");
  }
  return amount.trim();
}

async function main() {
  const appId = getRequiredEnv("PRIMUS_APP_ID");
  const appSecret = getRequiredEnv("PRIMUS_APP_SECRET");
  const recipient = getRequiredEnv("EXPECTED_FROM_ADDRESS");
  const rpcUrl = process.env.SEPOLIA_RPC_URL || getRequiredEnv("RPC_URL");
  const tokenAddress = getRequiredEnv("TOKEN_ADDRESS");
  const beneficiary = getRequiredEnv("TRA_BENEFICIARY");
  const amountInput = parseCliAmount();
  const okxApiKey = getRequiredEnv("OKX_API_KEY");
  const okxApiSecret = getRequiredEnv("OKX_API_SECRET");
  const okxApiPassphrase = getRequiredEnv("OKX_API_PASSPHRASE");
  const okxMethod = (process.env.OKX_ACCOUNT_CONFIG_METHOD || "GET").trim().toUpperCase();
  const okxKycPath = process.env.OKX_KYC_LEVEL_PATH?.trim() || "$.data[0].kycLv";
  const scene = process.env.REQUIRED_SCENE_VALUE?.trim() || "okx-account-config-transfer";
  const outputPath = path.resolve(
    process.cwd(),
    process.env.ATTESTATION_OUTPUT_PATH || "artifacts/okx-account-config-attestation.json",
  );
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  const decimals = await token.decimals();
  const amount = ethers.parseUnits(amountInput, decimals);

  console.log("Starting OKX KYC attestation request");

  const timestamp = new Date().toISOString();
  const signature = signOkxRequest({
    secret: okxApiSecret,
    timestamp,
    method: okxMethod,
    requestPath: OKX_ACCOUNT_CONFIG_PATH,
  });

  const headers = {
    "Content-Type": "application/json",
    "OK-ACCESS-KEY": okxApiKey,
    "OK-ACCESS-SIGN": signature,
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": okxApiPassphrase,
  };

  const simulatedTrading = process.env.OKX_SIMULATED_TRADING?.trim();
  if (simulatedTrading) {
    headers["x-simulated-trading"] = simulatedTrading;
  }

  const zkTls = new PrimusCoreTLS();
  await zkTls.init(appId, appSecret, "auto");

  const request = {
    url: OKX_ACCOUNT_CONFIG_URL,
    method: okxMethod,
    header: headers,
    body: "",
  };

  const responseResolves = [
    {
      keyName: "kycLv",
      parseType: "json",
      parsePath: okxKycPath,
    },
  ];

  const attRequest = zkTls.generateRequestParams(request, responseResolves, recipient);
  attRequest.setAttMode({
    algorithmType: "proxytls",
    resultType: "plain",
  });
  attRequest.setAdditionParams(
    JSON.stringify({
      scene,
      source: "okx",
      endpoint: "account-config",
      beneficiary: beneficiary.toLowerCase(),
      token: tokenAddress.toLowerCase(),
      amount: amount.toString(),
    }),
  );

  const attestation = await zkTls.startAttestation(attRequest, 2 * 60 * 1000);
  const localVerifyOk = zkTls.verifyAttestation(attestation);
  if (!localVerifyOk) {
    throw new Error("Local Primus verification failed");
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(attestation, null, 2)}\n`, "utf8");

  console.log("OKX KYC attestation generated");
  console.log(`- recipient: ${recipient}`);
  console.log(`- url: ${OKX_ACCOUNT_CONFIG_URL}`);
  console.log(`- kycPath: ${okxKycPath}`);
  console.log(`- beneficiary: ${beneficiary}`);
  console.log(`- token: ${tokenAddress}`);
  console.log(`- amount: ${amountInput} (${amount.toString()} base units)`);
  console.log(`- output: ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
