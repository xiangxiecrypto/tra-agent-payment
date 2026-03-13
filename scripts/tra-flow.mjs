import "dotenv/config";
import { spawn } from "node:child_process";

const DEFAULT_TRA_CONTRACT_ADDRESS = "0xFBF74694b8450695A382F35448e88bd817fceD26";

function createStageLogger() {
  const startTime = Date.now();

  return function logStage(message) {
    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[+${elapsedSeconds}s] ${message}`);
  };
}

function parseArgs(argv) {
  const amount = argv[0];
  const options = {
    help: argv.includes("--help") || argv.includes("-h"),
  };

  return { amount, options };
}

function printHelp() {
  console.log("TRA payment flow");
  console.log("");
  console.log("Usage:");
  console.log("  npm run tra -- <amount>");
  console.log("");
  console.log("Example:");
  console.log("  npm run tra -- 12.5");
  console.log("");
  console.log("What it does:");
  console.log("  1. Generate OKX KYC attestation");
  console.log("  2. Run contract preview");
  console.log("  3. Approve token if needed");
  console.log("  4. Send payment transaction");
  console.log("");
  console.log("Note:");
  console.log(`  Uses the default Sepolia TRA contract: ${DEFAULT_TRA_CONTRACT_ADDRESS}`);
}

function runNodeScript(scriptPath, amount) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [scriptPath, amount], {
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${scriptPath} failed with exit code ${code}`));
    });
  });
}

async function main() {
  const logStage = createStageLogger();
  const { amount, options } = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  if (!amount || !amount.trim()) {
    throw new Error("Provide amount, for example: npm run tra -- 12.5");
  }

  if (!process.env.TRA_CONTRACT_ADDRESS || !process.env.TRA_CONTRACT_ADDRESS.trim()) {
    process.env.TRA_CONTRACT_ADDRESS = DEFAULT_TRA_CONTRACT_ADDRESS;
  }

  logStage(`Starting TRA payment flow for amount: ${amount}`);
  logStage("Checking configuration");
  logStage(`Using TRA contract: ${process.env.TRA_CONTRACT_ADDRESS}`);

  console.log("");
  logStage("Generating OKX KYC attestation");
  await runNodeScript("scripts/generate-okx-account-config-attestation.mjs", amount.trim());

  console.log("");
  logStage("Running contract preview and payment execution");
  await runNodeScript("scripts/submit-tra-payment.mjs", amount.trim());

  console.log("");
  logStage("Payment confirmed");
}

main().catch((error) => {
  console.error("Payment failed");
  console.error(error.message || error);
  process.exitCode = 1;
});
