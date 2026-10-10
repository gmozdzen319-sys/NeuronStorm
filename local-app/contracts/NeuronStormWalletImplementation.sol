// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {WebAuthn} from "@openzeppelin/contracts/utils/cryptography/WebAuthn.sol";
import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {ClientData} from "./ClientData.sol";

// Production candidate: not audited or approved for Mainnet deployment.
// Derived from the tested ProbeWallet; no guardian/back-end recovery authority.
contract NeuronStormWalletImplementation {
    bool private initialized;
    address private immutable logicSelf=address(this);
    bool private entered;
    modifier nonReentrant() { require(!entered,"reentrant"); entered=true; _; entered=false; }
    struct Key { bytes32 x; bytes32 y; bool enabled; }
    mapping(bytes32 => Key) public keys;
    uint256 public keyCount;
    uint256 public nonce;
    uint256 public epoch;
    bytes32 public immutable rp;
    bytes32 public immutable originHash;
    bytes32[] private keyIds;
    constructor(bytes32 rp_, string memory origin_) {
        require(rp_!=bytes32(0) && bytes(origin_).length>0 && bytes(origin_).length<128,"bad-origin");
        rp=rp_; originHash=keccak256(bytes(origin_));
        initialized=true; // The logic contract itself can never acquire an owner.
    }
    // Called atomically by the factory immediately after CREATE2. No callback occurs.
    function initialize(bytes32 x, bytes32 y) external {
        require(!initialized,"initialized");
        initialized=true;
        _add(x,y);
    }
    function _clock() internal view virtual returns(uint256) { return block.timestamp; }
    function id(bytes32 x, bytes32 y) public pure returns(bytes32) { return keccak256(abi.encode(x,y)); }
    function keySlotCount() external view returns(uint256) { return keyIds.length; }
    function _add(bytes32 x, bytes32 y) internal {
        require(P256.isValidPublicKey(x,y) && !keys[id(x,y)].enabled && keyCount<8,"bad-add");
        bytes32 newId=id(x,y);
        keys[newId] = Key(x,y,true);
        bool inserted=false;
        for(uint256 i=0;i<keyIds.length;++i) {
            if(keyIds[i]==bytes32(0)){ keyIds[i]=newId; inserted=true; break; }
        }
        if(!inserted)keyIds.push(newId);
        ++keyCount;
    }
    function digest(uint8 action, bytes32 payload, uint256 deadline) public view returns(bytes32) {
        return keccak256(abi.encode("NS-WALLET-v1",block.chainid,address(this),epoch,nonce,action,payload,deadline));
    }
    function _check(bytes32 d,WebAuthn.WebAuthnAuth memory a,bytes32 x,bytes32 y) internal view returns(bool) {
        if(a.authenticatorData.length!=37) return false;
        bytes memory ad=a.authenticatorData;bytes32 rph;
        assembly {rph:=mload(add(ad,32))}
        if(rph!=rp) return false;
        uint8 flags=uint8(ad[32]);
        // UP + UV mandatory; backup state requires eligibility. No AT, ED or RFU
        // bits in this extension-free assertion profile (exactly 37 bytes).
        if((flags & 5)!=5 || (flags & 0xe2)!=0 || ((flags & 16)!=0 && (flags & 8)==0)) return false;
        if(!ClientData.validate(bytes(a.clientDataJSON),keccak256(bytes(Base64.encodeURL(abi.encodePacked(d)))),originHash)) return false;
        // The legacy index fields are untrusted ABI compatibility fields, not used
        // for validation. Nested/substr matches can never satisfy root fields.
        return P256.verify(sha256(abi.encodePacked(ad,sha256(bytes(a.clientDataJSON)))),a.r,a.s,x,y);
    }
    function verifyProbe(bytes32 d, WebAuthn.WebAuthnAuth calldata a, bytes32 x, bytes32 y) external view returns(bool) {
        return _check(d,a,x,y);
    }
    function _auth(uint8 action,bytes32 payload,uint256 deadline,bytes32 kid,WebAuthn.WebAuthnAuth memory a) internal {
        Key memory k=keys[kid];
        require(block.timestamp<=deadline && k.enabled,"expired-or-revoked");
        require(_check(digest(action,payload,deadline),a,k.x,k.y),"signature");
        ++nonce;
    }
    // Narrow token operation, no arbitrary delegatecall, approve, upgrade or server admin.
    function transfer(address token,address recipient,uint256 amount,uint256 deadline,bytes32 kid,WebAuthn.WebAuthnAuth calldata a) external nonReentrant {
        _auth(1,keccak256(abi.encode(token,recipient,amount)),deadline,kid,a);
        (bool ok,bytes memory ret)=token.call(abi.encodeWithSignature("transfer(address,uint256)",recipient,amount));
        require(ok && ret.length==32 && abi.decode(ret,(bool)),"transfer");
    }
    function addKey(bytes32 x,bytes32 y,uint256 deadline,bytes32 kid,WebAuthn.WebAuthnAuth calldata a) external nonReentrant {
        _auth(2,keccak256(abi.encode(x,y)),deadline,kid,a); _add(x,y);
    }
    function revoke(bytes32 victim,uint256 deadline,bytes32 kid,WebAuthn.WebAuthnAuth calldata a) external nonReentrant {
        _auth(3,keccak256(abi.encode(victim)),deadline,kid,a);
        require(keyCount>1 && keys[victim].enabled,"last-or-missing");
        keys[victim].enabled=false; --keyCount;
        for(uint256 i=0;i<keyIds.length;++i) if(keyIds[i]==victim)keyIds[i]=bytes32(0);
    }
    // Passive receipt does not grant any spending authority.
    receive() external payable { require(address(this)!=logicSelf,"implementation-only"); }

    // Cyprus-1 Quai-ledger addresses only. Cross-shard/Qi transfers require a
    // separately reviewed flow; never silently reinterpret the user's address.
    function transferNative(address payable recipient,uint256 amount,uint256 deadline,bytes32 kid,WebAuthn.WebAuthnAuth calldata a) external nonReentrant {
        require(recipient!=address(0) && recipient!=address(this) && (uint160(address(recipient))>>151)==0,"recipient");
        require(amount>0 && amount<=address(this).balance,"balance");
        _auth(5,keccak256(abi.encode(recipient,amount)),deadline,kid,a);
        (bool ok,)=recipient.call{value:amount}("");
        require(ok,"native-transfer");
    }
}
