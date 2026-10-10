// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Bounded JSON parser for the same-origin WebAuthn experiment. It hashes decoded
// strings for semantic comparisons; signature verification always uses raw JSON.
// Malformed/ambiguous/over-budget documents revert (fail closed).
library ClientData {
    error InvalidJSON();
    struct Cursor { bytes data; uint256 pos; }
    function need(bool ok) private pure { if (!ok) revert InvalidJSON(); }
    function ws(Cursor memory c) private pure {
        while(c.pos<c.data.length) { bytes1 b=c.data[c.pos];
            if(b!=0x20 && b!=0x09 && b!=0x0a && b!=0x0d) break; ++c.pos;
        }
    }
    function take(Cursor memory c, bytes1 b) private pure {
        need(c.pos<c.data.length && c.data[c.pos]==b); ++c.pos;
    }
    function digit(bytes1 b) private pure returns(bool) { return b>=0x30 && b<=0x39; }
    function hex4(Cursor memory c) private pure returns(uint256 n) {
        for(uint256 i; i<4; ++i) { need(c.pos<c.data.length); uint256 b=uint8(c.data[c.pos++]);
            if(b>=48 && b<=57) n=n*16+b-48;
            else if(b>=65 && b<=70) n=n*16+b-55;
            else if(b>=97 && b<=102) n=n*16+b-87;
            else revert InvalidJSON();
        }
    }
    function str(Cursor memory c) private pure returns(bytes32 h) {
        take(c,0x22); bytes memory out=new bytes(c.data.length-c.pos); uint256 j;
        while(true) {
            need(c.pos<c.data.length); uint256 b=uint8(c.data[c.pos++]);
            if(b==34) break;
            need(b>=32);
            if(b==92) {
                need(c.pos<c.data.length); b=uint8(c.data[c.pos++]);
                if(b==34 || b==92 || b==47) out[j++]=bytes1(uint8(b));
                else if(b==98) out[j++]=0x08;
                else if(b==102) out[j++]=0x0c;
                else if(b==110) out[j++]=0x0a;
                else if(b==114) out[j++]=0x0d;
                else if(b==116) out[j++]=0x09;
                else if(b==117) {
                    uint256 cp=hex4(c);
                    if(cp>=0xd800 && cp<=0xdbff) {
                        take(c,0x5c); take(c,0x75); uint256 low=hex4(c);
                        need(low>=0xdc00 && low<=0xdfff); cp=0x10000+(cp-0xd800)*1024+low-0xdc00;
                    } else need(cp<0xdc00 || cp>0xdfff);
                    if(cp<128) out[j++]=bytes1(uint8(cp));
                    else if(cp<2048) { out[j++]=bytes1(uint8(192|(cp>>6))); out[j++]=bytes1(uint8(128|(cp&63))); }
                    else if(cp<65536) { out[j++]=bytes1(uint8(224|(cp>>12))); out[j++]=bytes1(uint8(128|((cp>>6)&63))); out[j++]=bytes1(uint8(128|(cp&63))); }
                    else { out[j++]=bytes1(uint8(240|(cp>>18))); out[j++]=bytes1(uint8(128|((cp>>12)&63))); out[j++]=bytes1(uint8(128|((cp>>6)&63))); out[j++]=bytes1(uint8(128|(cp&63))); }
                } else revert InvalidJSON();
            } else if(b<128) out[j++]=bytes1(uint8(b));
            else {
                // Strict UTF-8: reject overlong sequences, surrogates and > U+10FFFF.
                uint256 count; uint256 cp; uint256 minimum;
                if(b>=194 && b<=223) { count=1;cp=b&31;minimum=128; }
                else if(b>=224 && b<=239) { count=2;cp=b&15;minimum=2048; }
                else if(b>=240 && b<=244) { count=3;cp=b&7;minimum=65536; }
                else revert InvalidJSON();
                out[j++]=bytes1(uint8(b));
                for(uint256 i;i<count;++i) { need(c.pos<c.data.length); b=uint8(c.data[c.pos++]); need(b>=128 && b<=191); cp=cp*64+(b&63);out[j++]=bytes1(uint8(b)); }
                need(cp>=minimum && cp<=0x10ffff && (cp<0xd800 || cp>0xdfff));
            }
        }
        assembly { mstore(out,j) }
        return keccak256(out);
    }
    function literal(Cursor memory c, bytes memory s) private pure { for(uint256 i;i<s.length;++i) take(c,s[i]); }
    // kind: 1 string, 2 false, 3 true, 4 other JSON value.
    function value(Cursor memory c,uint256 depth) private pure returns(uint256 kind,bytes32 h) {
        need(depth<=8);ws(c);need(c.pos<c.data.length);bytes1 b=c.data[c.pos];
        if(b==0x22) return(1,str(c));
        if(b==0x66) {literal(c,"false");return(2,0);}
        if(b==0x74) {literal(c,"true");return(3,0);}
        if(b==0x6e) {literal(c,"null");return(4,0);}
        if(b==0x7b) { object(c,depth,bytes32(0),bytes32(0),false);return(4,0); }
        if(b==0x5b) {
            ++c.pos;ws(c);need(c.pos<c.data.length);
            if(c.data[c.pos]==0x5d){++c.pos;return(4,0);}
            uint256 count;
            while(true){need(++count<=64);value(c,depth+1);ws(c);need(c.pos<c.data.length);if(c.data[c.pos]==0x5d){++c.pos;break;}take(c,0x2c);}
            return(4,0);
        }
        if(b==0x2d){++c.pos;need(c.pos<c.data.length);}
        if(c.data[c.pos]==0x30) ++c.pos;
        else { need(c.data[c.pos]>=0x31 && c.data[c.pos]<=0x39);while(c.pos<c.data.length && digit(c.data[c.pos]))++c.pos; }
        if(c.pos<c.data.length && c.data[c.pos]==0x2e){++c.pos;need(c.pos<c.data.length && digit(c.data[c.pos]));while(c.pos<c.data.length && digit(c.data[c.pos]))++c.pos;}
        if(c.pos<c.data.length && (c.data[c.pos]==0x65 || c.data[c.pos]==0x45)){
            ++c.pos;need(c.pos<c.data.length);if(c.data[c.pos]==0x2b || c.data[c.pos]==0x2d)++c.pos;
            need(c.pos<c.data.length && digit(c.data[c.pos]));while(c.pos<c.data.length && digit(c.data[c.pos]))++c.pos;
        }
        return(4,0);
    }
    function object(Cursor memory c,uint256 depth,bytes32 challenge,bytes32 origin,bool root) private pure returns(bool valid) {
        take(c,0x7b);ws(c);need(c.pos<c.data.length);bytes32[32] memory keys;uint256 n;uint256 seen;valid=true;
        if(c.data[c.pos]==0x7d){++c.pos;return !root;}
        while(true){
            ws(c);bytes32 key=str(c);need(n<32);for(uint256 i;i<n;++i)need(keys[i]!=key);keys[n++]=key;
            ws(c);take(c,0x3a);(uint256 kind,bytes32 h)=value(c,depth+1);
            if(root){
                if(key==keccak256("type")){seen|=1;valid=valid && kind==1 && h==keccak256("webauthn.get");}
                else if(key==keccak256("challenge")){seen|=2;valid=valid && kind==1 && h==challenge;}
                else if(key==keccak256("origin")){seen|=4;valid=valid && kind==1 && h==origin;}
                else if(key==keccak256("crossOrigin"))valid=valid && kind==2;
                else if(key==keccak256("topOrigin"))valid=false; // no cross-origin ceremonies in this profile
            }
            ws(c);need(c.pos<c.data.length);if(c.data[c.pos]==0x7d){++c.pos;break;}take(c,0x2c);
        }
        if(root)valid=valid && seen==7;
    }
    function validate(bytes memory data,bytes32 challenge,bytes32 origin) internal pure returns(bool) {
        need(data.length>0 && data.length<=4096);Cursor memory c=Cursor(data,0);ws(c);
        bool ok=object(c,0,challenge,origin,true);ws(c);need(c.pos==data.length);return ok;
    }
}
