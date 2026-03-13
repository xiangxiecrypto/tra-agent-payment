import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.connect();

const EXPECTED_URL = "https://www.okx.com/api/v5/account/config";
const EXPECTED_METHOD = "GET";
const MIN_KYC_LEVEL = 2;
const REQUIRED_SCENE_FRAGMENT = "\"scene\":\"okx-account-config-transfer\"";
const PAYMENT_AMOUNT = 10_000_000n;

function buildAttestation(overrides = {}) {
  return {
    recipient: overrides.recipient,
    request: {
      url: overrides.url ?? EXPECTED_URL,
      header:
        overrides.header ??
        "{\"Content-Type\":\"application/json\",\"OK-ACCESS-KEY\":\"key\",\"OK-ACCESS-SIGN\":\"sig\"}",
      method: overrides.method ?? EXPECTED_METHOD,
      body: overrides.body ?? "",
    },
    reponseResolve: [
      {
        keyName: "kycLv",
        parseType: "json",
        parsePath: "$.data[0].kycLv",
      },
    ],
    data: overrides.data ?? "{\"code\":\"0\",\"data\":[{\"kycLv\":\"3\",\"perm\":\"read_only\"}]}",
    attConditions: overrides.attConditions ?? "",
    timestamp: overrides.timestamp,
    additionParams:
      overrides.additionParams ??
      JSON.stringify({
        scene: "okx-account-config-transfer",
        source: "okx",
        beneficiary: overrides.beneficiary,
        token: overrides.token,
        amount: (overrides.amount ?? PAYMENT_AMOUNT).toString(),
      }),
    attestors: overrides.attestors ?? [],
    signatures: overrides.signatures ?? ["0x" + "11".repeat(65)],
  };
}

describe("TraKycEscrow", function () {
  async function deployFixture() {
    const [payer, beneficiary] = await ethers.getSigners();

    const token = await ethers.deployContract("MockERC20", ["Sepolia USDT", "USDT", 6]);
    const primus = await ethers.deployContract("MockPrimusZKTLS");
    const escrow = await ethers.deployContract("TraKycEscrow", [
      await primus.getAddress(),
      await token.getAddress(),
      beneficiary.address,
      EXPECTED_METHOD,
      REQUIRED_SCENE_FRAGMENT,
      MIN_KYC_LEVEL,
      1800,
      300,
    ]);

    await token.mint(payer.address, 100_000_000n);
    await token.approve(await escrow.getAddress(), 100_000_000n);

    const latestBlock = await ethers.provider.getBlock("latest");
    const attestation = buildAttestation({
      recipient: payer.address,
      timestamp: BigInt(latestBlock.timestamp),
      beneficiary: beneficiary.address.toLowerCase(),
      token: (await token.getAddress()).toLowerCase(),
      amount: PAYMENT_AMOUNT,
      attestors: [
        {
          attestorAddr: await primus.getAddress(),
          url: "https://primuslabs.xyz",
        },
      ],
    });

    return { payer, beneficiary, token, primus, escrow, attestation };
  }

  it("forwards tokens when attestation passes", async function () {
    const { payer, beneficiary, token, escrow, attestation } = await deployFixture();
    const amount = PAYMENT_AMOUNT;

    await expect(escrow.connect(payer).payWithOkxKyc(attestation, amount))
      .to.emit(escrow, "PaymentForwarded")
      .withArgs(payer.address, amount, EXPECTED_URL, attestation.timestamp);

    expect(await token.balanceOf(beneficiary.address)).to.equal(amount);
    expect(await token.balanceOf(await escrow.getAddress())).to.equal(0n);
    expect(await token.balanceOf(payer.address)).to.equal(90_000_000n);
  });

  it("refunds tokens when the request url mismatches", async function () {
    const { payer, beneficiary, token, escrow, attestation } = await deployFixture();
    const amount = PAYMENT_AMOUNT;
    const invalidAttestation = {
      ...attestation,
      request: {
        ...attestation.request,
        url: "https://evil.example.com/kyc/status",
      },
    };

    await expect(escrow.connect(payer).payWithOkxKyc(invalidAttestation, amount))
      .to.emit(escrow, "PaymentRefunded")
      .withArgs(payer.address, amount, "unexpected request url");

    expect(await token.balanceOf(beneficiary.address)).to.equal(0n);
    expect(await token.balanceOf(await escrow.getAddress())).to.equal(0n);
    expect(await token.balanceOf(payer.address)).to.equal(100_000_000n);
  });

  it("rejects expired attestations in preview", async function () {
    const { payer, escrow, attestation } = await deployFixture();
    const expiredAttestation = {
      ...attestation,
      timestamp: attestation.timestamp - 1801n,
    };

    const [ok, reason] = await escrow.previewPayment(expiredAttestation, payer.address, PAYMENT_AMOUNT);
    expect(ok).to.equal(false);
    expect(reason).to.equal("attestation expired");
  });

  it("rejects when Primus verification fails", async function () {
    const { payer, token, primus, escrow, attestation } = await deployFixture();
    const amount = PAYMENT_AMOUNT;

    await primus.setVerificationResult(false, "invalid signature");

    await expect(escrow.connect(payer).payWithOkxKyc(attestation, amount))
      .to.emit(escrow, "PaymentRefunded")
      .withArgs(payer.address, amount, "invalid signature");

    expect(await token.balanceOf(payer.address)).to.equal(100_000_000n);
  });

  it("accepts attestation timestamps expressed in milliseconds", async function () {
    const { payer, beneficiary, token, escrow, attestation } = await deployFixture();
    const amount = PAYMENT_AMOUNT;
    const millisAttestation = {
      ...attestation,
      timestamp: attestation.timestamp * 1000n,
    };

    await expect(escrow.connect(payer).payWithOkxKyc(millisAttestation, amount))
      .to.emit(escrow, "PaymentForwarded")
      .withArgs(payer.address, amount, EXPECTED_URL, millisAttestation.timestamp);

    expect(await token.balanceOf(beneficiary.address)).to.equal(amount);
  });

  it("refunds when kyc level is below the required threshold", async function () {
    const { payer, token, escrow, attestation } = await deployFixture();
    const amount = PAYMENT_AMOUNT;
    const lowLevelAttestation = {
      ...attestation,
      data: "{\"code\":\"0\",\"data\":[{\"kycLv\":\"1\",\"perm\":\"read_only\"}]}",
    };

    await expect(escrow.connect(payer).payWithOkxKyc(lowLevelAttestation, amount))
      .to.emit(escrow, "PaymentRefunded")
      .withArgs(payer.address, amount, "kyc level too low");

    expect(await token.balanceOf(payer.address)).to.equal(100_000_000n);
  });

  it("refunds when attested amount does not match the payment amount", async function () {
    const { payer, token, escrow, attestation } = await deployFixture();
    const amount = PAYMENT_AMOUNT;
    const invalidAttestation = {
      ...attestation,
      additionParams: JSON.stringify({
        scene: "okx-account-config-transfer",
        source: "okx",
        beneficiary: JSON.parse(attestation.additionParams).beneficiary,
        token: JSON.parse(attestation.additionParams).token,
        amount: (amount + 1n).toString(),
      }),
    };

    await expect(escrow.connect(payer).payWithOkxKyc(invalidAttestation, amount))
      .to.emit(escrow, "PaymentRefunded")
      .withArgs(payer.address, amount, "amount mismatch");

    expect(await token.balanceOf(payer.address)).to.equal(100_000_000n);
  });
});
