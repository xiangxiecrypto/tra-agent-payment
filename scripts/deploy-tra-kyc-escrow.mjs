import "dotenv/config";
import { network } from "hardhat";

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value.trim();
}

async function main() {
  const { ethers } = await network.connect({ network: "sepolia" });
  const primusVerifier = process.env.PRIMUS_VERIFIER_ADDRESS || "0x3760aB354507a29a9F5c65A66C74353fd86393FA";
  const tokenAddress = getRequiredEnv("TOKEN_ADDRESS");
  const beneficiary = process.env.TRA_BENEFICIARY || "0xf85b215Fcfa67959f0C5FAABEd3e34C3e11463a1";
  const expectedMethod = (process.env.OKX_ACCOUNT_CONFIG_METHOD || "GET").trim().toUpperCase();
  const requiredSceneFragment =
    process.env.REQUIRED_SCENE_FRAGMENT || "\"scene\":\"okx-account-config-transfer\"";
  const minKycLevel = BigInt(process.env.MIN_OKX_KYC_LEVEL || "2");
  const maxAttestationAge = BigInt(process.env.MAX_ATTESTATION_AGE_SECONDS || "1800");
  const maxFutureSkew = BigInt(process.env.MAX_FUTURE_SKEW_SECONDS || "300");

  const factory = await ethers.getContractFactory("TraKycEscrow");
  const contract = await factory.deploy(
    primusVerifier,
    tokenAddress,
    beneficiary,
    expectedMethod,
    requiredSceneFragment,
    minKycLevel,
    maxAttestationAge,
    maxFutureSkew,
  );
  await contract.waitForDeployment();

  console.log("TraKycEscrow deployed");
  console.log(`- address: ${await contract.getAddress()}`);
  console.log(`- primusVerifier: ${primusVerifier}`);
  console.log(`- token: ${tokenAddress}`);
  console.log(`- beneficiary: ${beneficiary}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
