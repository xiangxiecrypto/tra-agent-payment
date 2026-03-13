# tra-agent-payment

TRA is a gated payment flow for `USDT` on `Sepolia`.

This repository is designed primarily for `agent-driven execution`.

The intended usage model is that an AI agent receives a business instruction such as `pay 10 usdt with tra`, then automatically runs the full TRA workflow: generate the proof, validate eligibility, and complete or reject the payment. The CLI commands are provided both for direct usage and for agent orchestration.

Before funds are forwarded, the payer must present a valid `Primus zkTLS` attestation proving their `OKX account configuration` satisfies the required `kycLv`. The payment proof is also bound to the exact `beneficiary`, `token`, and `amount`, so it cannot be reused for a different transfer.

This project should be understood as the combination of:

- `Primus zkTLS` for identity and compliance proof generation
- `Pay Protocol` style enterprise wallet / payment infrastructure for controlled fund release

In other words, TRA brings together verifiable off-chain identity checks and enterprise-grade payment operations in a single agent-friendly flow.

The Primus integration pattern is based on the `primus-zktls-core-sdk` workflow:
- [primus-zktls-core-sdk](https://github.com/primus-labs/skills/tree/main/primus-zktls-core-sdk)

The enterprise wallet / payment infrastructure context is aligned with:
- [Pay Protocol Docs](https://doc.payprotocol.network/)

## Quick Start

If you only care about using the product flow, the path is:

1. Configure `.env`
2. Deploy the TRA contract once
3. Let the agent or unified CLI run one payment command with the amount you want to send

```bash
npm install
cp .env.example .env
npm run deploy:tra
npm run tra -- 12.5
```

What happens when you run `npm run tra -- 12.5`:

- the system checks the payer's OKX account configuration
- the system generates a proof for this exact payment
- the contract verifies the proof on-chain
- the payment is either sent or rejected

In the preferred setup, an agent triggers this command on the user's behalf after understanding a natural-language request.

## Business Flow

```text
User requests payment
        |
        v
Check OKX KYC eligibility
        |
        v
Generate payment-specific proof
        |
        v
Verify proof on-chain
        |
   +----+----+
   |         |
   v         v
Approved   Rejected
   |         |
   v         v
Pay USDT   Refund / no release
```

## User Journey

For a non-technical user, the business flow is:

1. The user enters the amount they want to pay.
2. Before the payment is sent, the system checks whether the user meets the required identity / compliance level through their OKX account.
3. The system creates a proof for this exact payment request, including:
   - who is paying
   - who will receive the funds
   - which token is being used
   - how much is being paid
4. The payment is only allowed to continue if that proof is valid and the user's OKX KYC level meets the required threshold.
5. If everything is valid, the funds are sent to the recipient.
6. If the proof is invalid or the KYC requirement is not met, the payment does not go through and the user keeps or gets back their funds.

In short: this is a compliance-gated payment flow. The user asks to pay, the system checks eligibility, and only then releases the payment.

For normal usage, the user only needs one command:

```bash
npm run tra -- <amount>
```

Example:

```bash
npm run tra -- 12.5
```

## Why This Exists

This repository is useful when a payment should only be allowed after an identity or compliance check.

Typical business value:

- reduce the risk of sending funds to ineligible users
- make payment release conditional on a verifiable compliance signal
- bind compliance proof to a specific transaction, not just to a user in general
- keep the operational flow simple for end users

## Architecture

At a high level, the architecture combines two product layers:

1. `Primus`
   - provides the zkTLS-based proof that the payer satisfies the required account / KYC condition

2. `Pay Protocol style payment infrastructure`
   - provides the enterprise wallet and controlled payment release model
   - ensures funds are only released after the proof is validated

The system has three layers:

1. `Identity proof generation`
   - `scripts/generate-okx-account-config-attestation.mjs`
   - Calls `OKX GET /api/v5/account/config`
   - Signs the private OKX API request with `OK-ACCESS-*` headers
   - Uses `Primus zkTLS` to generate an attestation
   - Binds `beneficiary`, `token`, and `amount` into `additionParams`

2. `On-chain verification`
   - `contracts/TraKycEscrow.sol`
   - Calls the deployed `Primus` verifier contract
   - Validates the attested request and payment binding
   - Enforces `kycLv >= MIN_OKX_KYC_LEVEL`

3. `Payment execution`
   - `scripts/submit-tra-payment.mjs`
   - Reads the attestation
   - Runs contract preview
   - Approves token allowance if needed
   - Calls `payWithOkxKyc`

There is also a unified runner:

- `scripts/tra-flow.mjs`
  - runs `attestation -> preview -> approve -> pay`

## Repository Layout

- `contracts/TraKycEscrow.sol`: Main escrow and verification contract
- `scripts/deploy-tra-kyc-escrow.mjs`: Deploys the TRA contract to Sepolia
- `scripts/generate-okx-account-config-attestation.mjs`: Builds the Primus attestation
- `scripts/submit-tra-payment.mjs`: Submits the payment through the deployed contract
- `scripts/tra-flow.mjs`: Unified end-to-end payment entrypoint

## Setup

Install dependencies:

```bash
npm install
```

Create your local config:

```bash
cp .env.example .env
```

## Where To Get Credentials

Before this flow can run, you need credentials from both `Primus` and `OKX`.

### Primus

You need:

- `PRIMUS_APP_ID`
- `PRIMUS_APP_SECRET`

Apply for them at:

- [Primus Developer Portal](https://dev.primuslabs.xyz/)

### OKX

You need:

- `OKX_API_KEY`
- `OKX_API_SECRET`
- `OKX_API_PASSPHRASE`

You can get them from:

- [OKX API management page](https://www.okx.com/account/my-api)
- [OKX API documentation](https://www.okx.com/docs-v5/en/)

For this repository, you should use a `Read`-only OKX API key.

Strong recommendation:

- use a key with `Read` permission only
- do not use a key with `Trade` permission
- do not use a key with `Withdraw` permission

This flow only needs to read:

- [OKX Get account configuration](https://www.okx.com/docs-v5/en/#trading-account-rest-api-get-account-configuration)

Important variables:

- `PRIVATE_KEY`: Payer wallet private key
- `EXPECTED_FROM_ADDRESS`: Expected sender address derived from the private key
- `TOKEN_ADDRESS`: Sepolia USDT contract
- `TRA_BENEFICIARY`: Recipient address
- `PRIMUS_APP_ID`
- `PRIMUS_APP_SECRET`
- `OKX_API_KEY`
- `OKX_API_SECRET`
- `OKX_API_PASSPHRASE`
- `MIN_OKX_KYC_LEVEL`: Minimum accepted KYC level, default `2`
- `TRA_CONTRACT_ADDRESS`: Deployed TRA contract address

Reference:
- [OKX Get account configuration](https://www.okx.com/docs-v5/en/#trading-account-rest-api-get-account-configuration)

## Commands

Compile contracts:

```bash
npm run compile
```

Run tests:

```bash
npm run test
```

Deploy the latest TRA contract:

```bash
npm run deploy:tra
```

Generate an attestation for a specific amount:

```bash
npm run attest:okx:config -- <amount>
```

Submit payment using an existing attestation:

```bash
npm run pay:tra -- <amount>
```

Run the full TRA payment flow:

```bash
npm run tra -- <amount>
```

## Agent Skill

This repository is built first for agent-driven usage, and it includes a project skill to support that model directly.

The goal is that an agent can understand prompts like:

```text
pay 10 usdt with tra
```

and automatically execute the correct TRA workflow.

Manual CLI usage is supported, but the main product idea is:

- the user gives a business instruction
- the agent interprets it
- the agent runs the correct guarded payment flow
- the agent reports progress and outcome back to the user

The skill is intended to:
- detect TRA payment intents
- extract the requested amount
- deploy the contract if needed
- run the unified flow command
- print progress status during execution
- report the transaction result back to the user

Recommended status updates for agent execution:

- `Starting TRA payment flow`
- `Generating OKX KYC attestation`
- `Running contract preview`
- `Submitting token approval`
- `Sending payment transaction`
- `Payment confirmed`
- `Payment failed` or `Payment refunded`
