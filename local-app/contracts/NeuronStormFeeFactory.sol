// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ReceiveClones} from "./ReceiveClones.sol";
import {NeuronStormFeeWallet} from "./NeuronStormFeeWallet.sol";

contract NeuronStormFeeFactory {
    address public immutable implementation;
    bytes32 public immutable implementationCodeHash;
    mapping(bytes32=>address) public walletOf;
    event WalletCreated(bytes32 indexed keyId,address indexed wallet,bytes32 salt);
    constructor(address logic) {
        require(logic.code.length>0 && (uint160(logic)>>151)==0,"implementation");
        implementation=logic;implementationCodeHash=logic.codehash;
    }
    function saltFor(bytes32 x,bytes32 y,uint256 grind) public pure returns(bytes32) {
        return keccak256(abi.encode("NS-FEE-WALLET-v3",x,y,grind));
    }
    function predict(bytes32 x,bytes32 y,uint256 grind) public view returns(address) {
        return ReceiveClones.predictDeterministicAddress(implementation,saltFor(x,y,grind),address(this));
    }
    function createWallet(bytes32 x,bytes32 y,uint256 grind) external returns(address wallet) {
        bytes32 keyId=keccak256(abi.encode(x,y));require(walletOf[keyId]==address(0),"already-provisioned");
        require(implementation.codehash==implementationCodeHash,"implementation-changed");
        address expected=predict(x,y,grind);
        require(expected!=address(0)&&(uint160(expected)>>151)==0,"unsupported-shard");
        wallet=ReceiveClones.cloneDeterministic(implementation,saltFor(x,y,grind));require(wallet==expected,"address");
        NeuronStormFeeWallet(payable(wallet)).initialize(x,y);walletOf[keyId]=wallet;
        emit WalletCreated(keyId,wallet,saltFor(x,y,grind));
    }
}
