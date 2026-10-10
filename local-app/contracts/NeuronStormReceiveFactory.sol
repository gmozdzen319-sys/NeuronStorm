// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReceiveClones as Clones} from "./ReceiveClones.sol";
import {NeuronStormWalletImplementation} from "./NeuronStormWalletImplementation.sol";

// Non-upgradeable candidate. No administrator, owner key, fee withdrawal or delegatecall.
// Permissionless provisioning can sponsor a user's deployment but cannot own their wallet.
contract NeuronStormReceiveFactory {
    address public immutable implementation;
    bytes32 public immutable implementationCodeHash;
    mapping(bytes32 => address) public walletOf;
    event WalletCreated(bytes32 indexed keyId, address indexed wallet, bytes32 salt);

    constructor(address logic) {
        require(logic.code.length > 0 && (uint160(logic) >> 151)==0,"implementation");
        implementation=logic;
        implementationCodeHash=logic.codehash;
    }

    function saltFor(bytes32 x, bytes32 y, uint256 grind) public pure returns(bytes32) {
        return keccak256(abi.encode("NS-RECEIVE-v2",x,y,grind));
    }

    function predict(bytes32 x, bytes32 y, uint256 grind) public view returns(address) {
        return Clones.predictDeterministicAddress(implementation,saltFor(x,y,grind),address(this));
    }

    function createWallet(bytes32 x, bytes32 y, uint256 grind) external returns(address wallet) {
        bytes32 keyId=keccak256(abi.encode(x,y));
        require(walletOf[keyId]==address(0),"already-provisioned");
        require(implementation.codehash==implementationCodeHash,"implementation-changed");
        bytes32 salt=saltFor(x,y,grind);
        address expected=predict(x,y,grind);
        require((uint160(expected)>>151)==0 && expected!=address(0),"unsupported-shard");
        wallet=Clones.cloneDeterministic(implementation,salt);
        require(wallet==expected,"address");
        NeuronStormWalletImplementation(payable(wallet)).initialize(x,y);
        walletOf[keyId]=wallet;
        emit WalletCreated(keyId,wallet,salt);
    }
}
