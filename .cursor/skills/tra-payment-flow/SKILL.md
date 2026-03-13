---
name: tra-payment-flow
description: Execute the TRA payment workflow for this repository. Use when the user wants to pay USDT with TRA, mentions prompts like "pay 10 usdt with tra", "run the tra flow", "send payment with tra", or asks to generate the OKX attestation and complete the guarded payment flow.
---

# TRA Payment Flow

Use this skill for the repository's guarded TRA payment flow.

## What This Skill Does

This skill handles the full payment path:

1. Ensure the project is compiled
2. Ensure a TRA contract is deployed
3. Generate an OKX account-config attestation for the requested amount
4. Run contract preview and token approval
5. Execute `payWithOkxKyc`
6. Return the deployed contract address and transaction hashes

## Trigger Phrases

Apply this skill when the user says things like:

- `pay 10 usdt with tra`
- `run the tra payment`
- `pay with tra`
- `generate attestation and pay`
- `send 5 usdt through tra`

## Required Context

Before running the flow, confirm that `.env` contains:

- `PRIVATE_KEY`
- `TOKEN_ADDRESS`
- `PRIMUS_APP_ID`
- `PRIMUS_APP_SECRET`
- `OKX_API_KEY`
- `OKX_API_SECRET`
- `OKX_API_PASSPHRASE`

If any of these are missing, ask the user to provide them.

The payer address is derived automatically from `PRIVATE_KEY`; the user does not need to provide it separately.

If `.env` is missing required values, do not only say what is missing. Also include direct links so the user can go straight to the right place without searching.

Use these links when prompting for missing credentials:

- `PRIMUS_APP_ID` / `PRIMUS_APP_SECRET`
  - [Primus Developer Portal](https://dev.primuslabs.xyz/)
- `OKX_API_KEY` / `OKX_API_SECRET` / `OKX_API_PASSPHRASE`
  - [OKX API management page](https://www.okx.com/account/my-api)
  - [OKX API documentation](https://www.okx.com/docs-v5/en/)

When asking the user to configure `.env`, prefer a short actionable format like:

- `Missing PRIMUS_APP_ID and PRIMUS_APP_SECRET. Get them here: https://dev.primuslabs.xyz/`
- `Missing OKX API credentials. Create a Read-only OKX API key here: https://www.okx.com/account/my-api`

## Execution Rules

### 1. Amount handling

- Treat the user-provided amount as required input
- Do not invent a default payment amount
- Use the exact same amount for attestation generation and payment submission

### 2. Deployment handling

- If `TRA_CONTRACT_ADDRESS` is empty, deploy first with:

```bash
npm run deploy:tra
```

- If the contract logic changed in this conversation and the new logic must be used, redeploy and update `.env`

### 3. Preferred command

For normal usage, prefer the unified command:

```bash
npm run tra -- <amount>
```

This command already performs:

- attestation generation
- preview
- approval if needed
- payment execution

### 4. If debugging is needed

Run the steps separately:

```bash
npm run attest:okx:config -- <amount>
npm run pay:tra -- <amount>
```

Use this only when the unified command fails and you need to isolate the issue.

## Expected Outputs

After success, report:

- the TRA contract address used
- the approval transaction hash, if any
- the payment transaction hash
- the confirmation block number

If the flow fails, report the exact failing stage:

- deployment
- attestation generation
- preview
- approval
- payment execution

## Status Updates

When the agent executes this skill, it should provide short progress updates to the user at each major stage.

Preferred status messages:

- `Starting TRA payment flow`
- `Checking configuration`
- `Deploying TRA contract`
- `Generating OKX KYC attestation`
- `Running contract preview`
- `Submitting token approval`
- `Sending payment transaction`
- `Payment confirmed`
- `Payment failed`
- `Payment refunded`

If a stage fails, the agent should clearly say which stage failed and stop before claiming success.

Examples:

- `Starting TRA payment flow for 10 USDT.`
- `Generating OKX KYC attestation now.`
- `Running contract preview before sending the transaction.`
- `Sending payment transaction on Sepolia.`
- `Payment confirmed successfully.`

If the contract preview or payment call indicates a refund path or validation rejection, the agent should explicitly say that the payment was rejected or refunded rather than saying the transfer succeeded.

## Repository-Specific Notes

- The attestation is bound to:
  - `beneficiary`
  - `token`
  - `amount`
- The contract validates:
  - `OKX /api/v5/account/config`
  - `kycLv`
  - attestation timestamp
  - payment binding fields
- Normal usage should go through `npm run tra -- <amount>`
