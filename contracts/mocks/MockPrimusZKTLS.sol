// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IPrimusZKTLS, Attestation} from "@primuslabs/zktls-contracts/src/IPrimusZKTLS.sol";

contract MockPrimusZKTLS is IPrimusZKTLS {
    bool public shouldVerify = true;
    string public failureReason = "mock verify failed";

    function setVerificationResult(bool shouldVerify_, string calldata failureReason_) external {
        shouldVerify = shouldVerify_;
        failureReason = failureReason_;
    }

    function verifyAttestation(Attestation calldata) external view override {
        require(shouldVerify, failureReason);
    }
}
