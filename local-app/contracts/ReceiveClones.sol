// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Local candidate only. Empty calldata accepts QUAI without DELEGATECALL.
/// Nonempty calldata retains EIP-1167 return/revert forwarding and isolated storage.
library ReceiveClones {
    function initCode(address implementation) internal pure returns (bytes memory) {
        // Runtime: CALLDATASIZE ISZERO PUSH1(50) JUMPI; EIP-1167 body;
        // JUMPDEST STOP. The body's success destination shifts from 43 to 48.
        // Runtime length 52, constructor prefix length 10. No storage or admin.
        return abi.encodePacked(
            hex"3d603480600a3d3981f3",
            hex"3615603257363d3d373d3d3d363d73", implementation,
            hex"5af43d82803e903d91603057fd5bf35b00"
        );
    }

    function cloneDeterministic(address implementation, bytes32 salt) internal returns (address instance) {
        bytes memory code = initCode(implementation);
        assembly { instance := create2(0, add(code, 32), mload(code), salt) }
        require(instance != address(0), "create2-failed");
    }

    function predictDeterministicAddress(address implementation, bytes32 salt, address deployer) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(
            bytes1(0xff), deployer, salt, keccak256(initCode(implementation))
        )))));
    }
}
