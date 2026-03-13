# tra-agent-payment

TRA is a gated payment flow for `USDT` on `Sepolia`.

Before funds are forwarded, the payer must present a valid `Primus zkTLS` attestation proving their `OKX account configuration` satisfies the required `kycLv`. The payment proof is also bound to the exact `beneficiary`, `token`, and `amount`, so it cannot be reused for a different transfer.

The Primus integration pattern is based on the `primus-zktls-core-sdk` workflow:
- [primus-zktls-core-sdk](https://github.com/primus-labs/skills/tree/main/primus-zktls-core-sdk)

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

## Architecture

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

This repository now includes a project skill for agent-driven usage.

The goal is that an agent can understand prompts like:

```text
pay 10 usdt with tra
```

and automatically execute the correct TRA workflow.

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
