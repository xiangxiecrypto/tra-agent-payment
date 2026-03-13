// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {
    IPrimusZKTLS,
    Attestation
} from "@primuslabs/zktls-contracts/src/IPrimusZKTLS.sol";

contract TraKycEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;

    string public constant OKX_ACCOUNT_CONFIG_PATH = "/api/v5/account/config";
    string public constant OKX_ACCOUNT_CONFIG_URL = "https://www.okx.com/api/v5/account/config";
    string private constant KYC_LEVEL_FIELD_NAME = '"kycLv"';

    IERC20 public immutable settlementToken;
    address public immutable beneficiary;
    address public immutable primusVerifier;
    bytes32 public immutable expectedRequestMethodHash;
    uint8 public immutable minKycLevel;
    uint64 public immutable maxAttestationAge;
    uint64 public immutable maxFutureSkew;

    string public requiredSceneFragment;

    event PaymentForwarded(
        address indexed payer,
        uint256 amount,
        string requestUrl,
        uint64 attestationTimestamp
    );
    event PaymentRefunded(address indexed payer, uint256 amount, string reason);

    constructor(
        address primusVerifier_,
        address settlementToken_,
        address beneficiary_,
        string memory expectedRequestMethod_,
        string memory requiredSceneFragment_,
        uint8 minKycLevel_,
        uint64 maxAttestationAge_,
        uint64 maxFutureSkew_
    ) {
        require(primusVerifier_ != address(0), "invalid primus");
        require(settlementToken_ != address(0), "invalid token");
        require(beneficiary_ != address(0), "invalid beneficiary");
        require(bytes(expectedRequestMethod_).length != 0, "empty method");
        require(minKycLevel_ <= 9, "invalid min kyc");
        require(maxAttestationAge_ != 0, "invalid max age");

        primusVerifier = primusVerifier_;
        settlementToken = IERC20(settlementToken_);
        beneficiary = beneficiary_;
        expectedRequestMethodHash = keccak256(bytes(expectedRequestMethod_));
        requiredSceneFragment = requiredSceneFragment_;
        minKycLevel = minKycLevel_;
        maxAttestationAge = maxAttestationAge_;
        maxFutureSkew = maxFutureSkew_;
    }

    function previewPayment(
        Attestation calldata attestation,
        address payer,
        uint256 amount
    ) external view returns (bool ok, string memory reason) {
        return _validateAttestation(attestation, payer, amount);
    }

    function payWithOkxKyc(
        Attestation calldata attestation,
        uint256 amount
    ) external nonReentrant returns (bool forwarded, string memory reason) {
        require(amount != 0, "amount is zero");

        settlementToken.safeTransferFrom(msg.sender, address(this), amount);

        (bool ok, string memory failureReason) = _validateAttestation(attestation, msg.sender, amount);
        if (!ok) {
            settlementToken.safeTransfer(msg.sender, amount);
            emit PaymentRefunded(msg.sender, amount, failureReason);
            return (false, failureReason);
        }

        settlementToken.safeTransfer(beneficiary, amount);
        emit PaymentForwarded(msg.sender, amount, attestation.request.url, attestation.timestamp);
        return (true, "");
    }

    function verifyWithPrimus(Attestation calldata attestation) external view returns (bool) {
        require(msg.sender == address(this), "only self");
        IPrimusZKTLS(primusVerifier).verifyAttestation(attestation);
        return true;
    }

    function _validateAttestation(
        Attestation calldata attestation,
        address payer,
        uint256 amount
    ) internal view returns (bool ok, string memory reason) {
        if (attestation.recipient != payer) {
            return (false, "recipient mismatch");
        }

        if (keccak256(bytes(attestation.request.url)) != keccak256(bytes(OKX_ACCOUNT_CONFIG_URL))) {
            return (false, "unexpected request url");
        }

        if (keccak256(bytes(attestation.request.method)) != expectedRequestMethodHash) {
            return (false, "unexpected request method");
        }

        (bool foundKycLevel, uint8 kycLevel) = _extractSingleDigitUint(
            attestation.data,
            KYC_LEVEL_FIELD_NAME
        );
        if (!foundKycLevel) {
            return (false, "kyc level missing");
        }

        if (kycLevel < minKycLevel) {
            return (false, "kyc level too low");
        }

        if (
            !_contains(
                attestation.additionParams,
                _addressAdditionFragment("beneficiary", beneficiary)
            )
        ) {
            return (false, "beneficiary mismatch");
        }

        if (
            !_contains(
                attestation.additionParams,
                _addressAdditionFragment("token", address(settlementToken))
            )
        ) {
            return (false, "token mismatch");
        }

        if (
            !_contains(
                attestation.additionParams,
                _uintAdditionFragment("amount", amount)
            )
        ) {
            return (false, "amount mismatch");
        }

        if (
            bytes(requiredSceneFragment).length != 0 &&
            !_contains(attestation.additionParams, requiredSceneFragment)
        ) {
            return (false, "unexpected attestation scene");
        }

        uint64 attestationTimestamp = _normalizeTimestamp(attestation.timestamp);

        if (attestationTimestamp > block.timestamp + maxFutureSkew) {
            return (false, "attestation timestamp too new");
        }

        if (block.timestamp > attestationTimestamp + maxAttestationAge) {
            return (false, "attestation expired");
        }

        try this.verifyWithPrimus(attestation) returns (bool) {
            return (true, "");
        } catch Error(string memory err) {
            return (false, err);
        } catch {
            return (false, "primus verification failed");
        }
    }

    function _contains(
        string calldata haystack,
        string memory needle
    ) internal pure returns (bool) {
        bytes calldata haystackBytes = bytes(haystack);
        bytes memory needleBytes = bytes(needle);

        if (needleBytes.length == 0) {
            return true;
        }

        if (needleBytes.length > haystackBytes.length) {
            return false;
        }

        for (uint256 i = 0; i <= haystackBytes.length - needleBytes.length; i++) {
            bool matched = true;
            for (uint256 j = 0; j < needleBytes.length; j++) {
                if (haystackBytes[i + j] != needleBytes[j]) {
                    matched = false;
                    break;
                }
            }
            if (matched) {
                return true;
            }
        }

        return false;
    }

    function _extractSingleDigitUint(
        string calldata haystack,
        string memory fieldName
    ) internal pure returns (bool found, uint8 value) {
        bytes calldata haystackBytes = bytes(haystack);
        bytes memory fieldBytes = bytes(fieldName);

        if (fieldBytes.length == 0 || fieldBytes.length >= haystackBytes.length) {
            return (false, 0);
        }

        for (uint256 i = 0; i <= haystackBytes.length - fieldBytes.length; i++) {
            bool matched = true;
            for (uint256 j = 0; j < fieldBytes.length; j++) {
                if (haystackBytes[i + j] != fieldBytes[j]) {
                    matched = false;
                    break;
                }
            }

            if (!matched) {
                continue;
            }

            uint256 valueIndex = i + fieldBytes.length;
            while (valueIndex < haystackBytes.length) {
                bytes1 charValue = haystackBytes[valueIndex];
                if (charValue >= 0x30 && charValue <= 0x39) {
                    return (true, uint8(uint8(charValue) - 48));
                }
                valueIndex++;
            }
            return (false, 0);
        }

        return (false, 0);
    }

    function _normalizeTimestamp(uint64 rawTimestamp) internal pure returns (uint64) {
        if (rawTimestamp > 1000000000000) {
            return rawTimestamp / 1000;
        }
        return rawTimestamp;
    }

    function _addressAdditionFragment(
        string memory fieldName,
        address value
    ) internal pure returns (string memory) {
        return string(
            abi.encodePacked(
                "\"",
                fieldName,
                "\":\"",
                _addressToString(value),
                "\""
            )
        );
    }

    function _uintAdditionFragment(
        string memory fieldName,
        uint256 value
    ) internal pure returns (string memory) {
        return string(
            abi.encodePacked(
                "\"",
                fieldName,
                "\":\"",
                _uintToString(value),
                "\""
            )
        );
    }

    function _addressToString(address account) internal pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory data = new bytes(42);
        data[0] = "0";
        data[1] = "x";

        uint256 value = uint256(uint160(account));
        for (uint256 i = 0; i < 20; i++) {
            uint8 b = uint8(value >> (8 * (19 - i)));
            data[2 + i * 2] = alphabet[b >> 4];
            data[3 + i * 2] = alphabet[b & 0x0f];
        }

        return string(data);
    }

    function _uintToString(uint256 value) internal pure returns (string memory) {
        if (value == 0) {
            return "0";
        }

        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }

        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }

        return string(buffer);
    }
}
