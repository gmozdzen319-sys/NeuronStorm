// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {NeuronStormWalletImplementation} from "./NeuronStormWalletImplementation.sol";
import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";

/// Same ownership, WebAuthn verifier and receive-compatible clone architecture.
/// Fees are explicit, signed quotes, NOT a claim about the eventual receipt cost.
contract NeuronStormFeeWallet is NeuronStormWalletImplementation {
    struct SendQuote {
        address token; // address(0) denotes native QUAI
        address payable recipient;
        uint256 amount;
        address payable relayer;
        uint256 networkFee;
        uint256 gasPrice;
        bytes32 requestId;
    }
    event QuotedSend(bytes32 indexed requestId, address indexed token, address indexed recipient,
        uint256 amount, address relayer, uint256 networkFee, uint256 serviceFee);

    constructor(bytes32 rp_, string memory origin_) NeuronStormWalletImplementation(rp_,origin_) {}

    function serviceFee(uint256 networkFee) public pure returns(uint256) {
        // Exactly 5%, rounded UP to the smallest QUAI unit; no overflowing multiply.
        return networkFee / 20 + (networkFee % 20 == 0 ? 0 : 1);
    }
    function quotePayload(SendQuote calldata q) public pure returns(bytes32) {
        return keccak256(abi.encode("NS-SEND-QUOTE-v1",q));
    }
    function supported(address a) private view returns(bool) {
        return a!=address(0) && a!=address(this) && (uint160(a)>>151)==0;
    }
    function tokenBalance(address token,address owner) private view returns(uint256) {
        (bool ok,bytes memory result)=token.staticcall(abi.encodeWithSignature("balanceOf(address)",owner));
        require(ok && result.length==32,"token-balance");
        return abi.decode(result,(uint256));
    }
    function sendQuoted(SendQuote calldata q,uint256 deadline,bytes32 kid,WebAuthn.WebAuthnAuth calldata a) external nonReentrant {
        require(supported(q.recipient) && supported(q.relayer),"recipient");
        require(msg.sender==q.relayer && tx.gasprice==q.gasPrice && q.gasPrice>0,"relayer-price");
        require(q.requestId!=bytes32(0) && q.amount>0 && q.networkFee>0,"quote");
        uint256 service=serviceFee(q.networkFee);uint256 fee=q.networkFee+service;
        require(address(this).balance>=fee,"fee-balance");
        _auth(6,quotePayload(q),deadline,kid,a);
        if(q.token==address(0)) {
            require(q.amount<=address(this).balance-fee,"balance");
            (bool ok,)=q.recipient.call{value:q.amount}("");require(ok,"native-transfer");
        } else {
            require(supported(q.token) && q.token.code.length>0,"token");
            uint256 beforeOwner=tokenBalance(q.token,address(this));uint256 beforeRecipient=tokenBalance(q.token,q.recipient);
            require(beforeOwner>=q.amount,"token-funds");
            (bool ok,bytes memory result)=q.token.call(abi.encodeWithSignature("transfer(address,uint256)",q.recipient,q.amount));
            require(ok && (result.length==0 || (result.length==32 && abi.decode(result,(bool)))),"token-transfer");
            // Reject fee-on-transfer/rebasing side effects instead of silently short-paying.
            require(tokenBalance(q.token,address(this))==beforeOwner-q.amount,"token-debit");
            require(tokenBalance(q.token,q.recipient)==beforeRecipient+q.amount,"token-credit");
        }
        (bool paid,)=q.relayer.call{value:fee}("");require(paid,"fee-transfer");
        emit QuotedSend(q.requestId,q.token,q.recipient,q.amount,q.relayer,q.networkFee,service);
    }
}
