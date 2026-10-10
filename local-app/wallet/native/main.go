// Native in-memory execution only. No RPC client, keys or broadcast code.
package main
import (
 "encoding/json"
 "encoding/hex"
 "fmt"
 "math/big"
 "os"
 "strings"
 "github.com/dominant-strategies/go-quai/common"
 "github.com/dominant-strategies/go-quai/core"
 "github.com/dominant-strategies/go-quai/core/rawdb"
 "github.com/dominant-strategies/go-quai/core/state"
 "github.com/dominant-strategies/go-quai/core/types"
 "github.com/dominant-strategies/go-quai/core/vm"
 "github.com/dominant-strategies/go-quai/log"
 "github.com/dominant-strategies/go-quai/params"
)
type Tx struct {Name,Data,To,From,Value,ExpectedReturn,ExpectedContract string; Nonce,Gas uint64; ExpectRevert bool; ExpectedNonce *uint64}
type SecurityCase struct {Name,Data string;Expected,MustRevert bool}
type Account struct {Address,Balance,Code string;Nonce uint64;Storage map[string]string}
type Input struct {Generic bool;Scale bool;FactoryPadding uint64;Factory string; BalanceAddresses []string; Sender,Block,Time,StateSize,Price string; StartNonce uint64; Txs []Tx; WrongReceiver,Replay,WalletNonce,WalletBalance,RecipientBalance string; Wallet,Token,DigestQuery,ExpectedDigest,VerifyQuery string;SecurityCases []SecurityCase;OperationCases []SecurityCase;Single bool;FinalizeSnapshot bool;Accounts []Account;AccessList types.AccessList}
type Outcome struct {Error string `json:"error,omitempty"`; Gas uint64 `json:"gas"`; Return string `json:"return"`; Contract string `json:"contract,omitempty"`; ACL types.AccessList `json:"accessList,omitempty"`}
type Check struct {Name string `json:"name"`; Passed bool `json:"passed"`; Outcome Outcome `json:"outcome"`}
var loc=common.Location{0,0}
var cfg=params.ProgpowColosseumChainConfig
var in Input
var sender common.Address
var checks=[]Check{}
func integer(s string)*big.Int {n,ok:=new(big.Int).SetString(s,0);if !ok{panic("invalid integer "+s)};return n}
func bytes(s string)[]byte {v,e:=hex.DecodeString(strings.TrimPrefix(s,"0x"));if e!=nil{panic(e)};return v}
func run(s *state.StateDB,t Tx,list types.AccessList,debug bool) Outcome {
 sender:=sender; if t.From!="" {sender=common.HexToAddress(t.From,loc)}
 s.Prepare(common.Hash{},0)
 var to *common.Address
 if t.To!="" {a:=common.HexToAddress(t.To,loc);to=&a}
 dest:=common.ZeroAddress(loc);if to!=nil{dest=*to}
 tracer:=vm.NewAccessListTracer(list,sender,dest,vm.ActivePrecompiles(cfg.Rules(integer(in.Block)),loc))
 vc:=vm.Config{};if debug{vc.Debug=true;vc.Tracer=tracer}
 bc:=vm.BlockContext{CanTransfer:core.CanTransfer,Transfer:core.Transfer,GetHash:func(n uint64)common.Hash{return common.Hash{}},PrimaryCoinbase:common.HexToAddress("0x0011111111111111111111111111111111111111",loc),GasLimit:50000000,BlockNumber:integer(in.Block),Time:integer(in.Time),Difficulty:big.NewInt(1),BaseFee:big.NewInt(0),QuaiStateSize:integer(in.StateSize)}
 tc:=vm.TxContext{Origin:sender,GasPrice:integer(in.Price),AccessList:list}
 evm:=vm.NewEVM(bc,tc,s,cfg,vc,nil)
 value:=new(big.Int);if t.Value!="" {value=integer(t.Value)}
 msg:=types.NewMessage(sender,to,t.Nonce,value,t.Gas,integer(in.Price),bytes(t.Data),list,false)
 res,err:=core.ApplyMessage(evm,msg,new(types.GasPool).AddGas(50000000))
 o:=Outcome{}
 if err!=nil{o.Error=err.Error()}else{if res.Err!=nil{o.Error=res.Err.Error()};o.Gas=res.UsedGas;o.Return="0x"+hex.EncodeToString(res.ReturnData);if res.ContractAddr!=nil{o.Contract=res.ContractAddr.Hex()}}
 if debug{o.ACL=tracer.AccessList(loc)}
 return o
}
func discover(s *state.StateDB,t Tx,allowError bool)types.AccessList {
 var acl types.AccessList
 for i:=0;i<3;i++{o:=run(s.Copy(),t,acl,true);if o.Error!=""&&!allowError{data,_:=json.MarshalIndent(map[string]interface{}{"failedDiscovery":o,"checks":checks},"","  ");os.WriteFile(os.Args[2],data,0600);panic("discovery "+t.Name+": "+o.Error+" "+o.Return)};acl=o.ACL}
 return acl
}
func check(name string,o Outcome,expect string){pass:=o.Error=="";if expect!=""{pass=strings.Contains(o.Error,expect)};if expect=="observe"{pass=o.Error==""||strings.Contains(o.Error,"invalid access list")||strings.Contains(o.Error,"invalid opcode")};checks=append(checks,Check{name,pass,o})}
func clone(list types.AccessList)types.AccessList {out:=make(types.AccessList,len(list));for i,a:=range list{out[i]=a;out[i].StorageKeys=append([]common.Hash{},a.StorageKeys...)};return out}
func query(s *state.StateDB,to,data string)string {i,_:=sender.InternalAndQuaiAddress();t:=Tx{Name:"query",To:to,Data:data,Nonce:s.GetNonce(i),Gas:1000000};a:=discover(s,t,false);o:=run(s.Copy(),t,a,false);if o.Error!=""{panic(o.Error)};return o.Return}
func main(){
 raw,e:=os.ReadFile(os.Args[1]);if e!=nil{panic(e)};if e=json.Unmarshal(raw,&in);e!=nil{panic(e)}
 cfgCopy:=*cfg;cfg=&cfgCopy;cfg.Location=loc;vm.InitializePrecompiles(loc)
 sender=common.HexToAddress(in.Sender,loc)
 db:=rawdb.NewMemoryDatabase(log.Global)
 s,e:=state.New(common.Hash{},common.Hash{},integer(in.StateSize),state.NewDatabase(db),state.NewDatabase(rawdb.NewMemoryDatabase(log.Global)),nil,loc,log.Global);if e!=nil{panic(e)}
 ia,e:=sender.InternalAndQuaiAddress();if e!=nil{panic(e)};s.SetBalance(ia,new(big.Int).Exp(big.NewInt(10),big.NewInt(30),nil));s.SetNonce(ia,in.StartNonce)
 if in.Generic {
  for _,t:=range in.Txs {if t.From!="" {addr:=common.HexToAddress(t.From,loc);i,e:=addr.InternalAndQuaiAddress();if e!=nil{panic(e)};s.SetBalance(i,new(big.Int).Exp(big.NewInt(10),big.NewInt(30),nil))}}
  plans:=[]map[string]interface{}{}
  for _,t:=range in.Txs {
   if t.Name=="wallet" && in.FactoryPadding>0 {
    address:=common.HexToAddress(in.Factory,loc);i,e:=address.InternalAndQuaiAddress();if e!=nil{panic(e)}
    for n:=uint64(0);n<in.FactoryPadding;n++ {s.SetState(i,common.BigToHash(new(big.Int).SetUint64(n+1000000000)),common.BigToHash(big.NewInt(1)))}
    s.IntermediateRoot(false)
   }
   if t.Name=="native-send" {
    for _,c:=range in.SecurityCases {p:=t;p.To=in.Wallet;p.Data=c.Data;p.Gas=8000000;a:=discover(s,p,true);o:=run(s.Copy(),p,a,false);valid:=o.Error==""&&o.Return=="0x"+strings.Repeat("0",63)+"1";rejected:=o.Error=="execution reverted"||(o.Error==""&&o.Return=="0x"+strings.Repeat("0",64));pass:=valid;if !c.Expected{pass=rejected};checks=append(checks,Check{"WebAuthn: "+c.Name,pass,o})}
    for _,c:=range in.OperationCases {p:=t;p.Data=c.Data;a:=discover(s,p,true);check(c.Name,run(s.Copy(),p,a,false),"execution reverted")}
   }
   acl:=discover(s,t,t.ExpectRevert)
   if !in.Scale && (t.To==""||t.Name=="native-send"||t.Name=="wallet"||t.Name=="second-user") {
    check(t.Name+": absent ACL",run(s.Copy(),t,nil,false),"invalid access list")
    for i,a:=range acl {for k:=range a.StorageKeys {missing:=clone(acl);missing[i].StorageKeys=append(missing[i].StorageKeys[:k],missing[i].StorageKeys[k+1:]...);check(fmt.Sprintf("%s: removed storage key %d/%d",t.Name,i,k),run(s.Copy(),t,missing,false),"observe")}}
    old:=t;old.Nonce++;check(t.Name+": changed relayer nonce",run(s.Copy(),old,acl,false),"nonce too high")
   }
   before:=s.Copy();o:=run(s,t,acl,false);expected:="";if t.ExpectRevert{expected="execution reverted"};check(t.Name,o,expected)
   if t.ExpectedReturn!="" {checks=append(checks,Check{t.Name+": exact return",o.Error==""&&o.Return==t.ExpectedReturn,o})}
   if t.ExpectedContract!="" {checks=append(checks,Check{t.Name+": exact CREATE",strings.EqualFold(o.Contract,t.ExpectedContract),o})}
   if t.ExpectedNonce!=nil{v:=query(s,in.Wallet,in.WalletNonce);checks=append(checks,Check{t.Name+": wallet nonce",integer(v).Uint64()==*t.ExpectedNonce,Outcome{Return:v}})}
   lo,hi:=uint64(21000),t.Gas;if o.Error==""{for lo+1<hi{mid:=(lo+hi)/2;p:=t;p.Gas=mid;if run(before.Copy(),p,acl,false).Error==""{hi=mid}else{lo=mid}}}
   plans=append(plans,map[string]interface{}{"name":t.Name,"accessList":acl,"gasUsed":o.Gas,"minimumGas":hi,"contract":o.Contract,"error":o.Error})
   s.IntermediateRoot(false)
  }
  codes:=map[string]string{}; balances:=map[string]string{};for _,a:=range in.BalanceAddresses{address:=common.HexToAddress(a,loc);internal,e:=address.InternalAndQuaiAddress();if e!=nil{panic(e)};balances[a]=s.GetBalance(internal).String();codes[a]="0x"+hex.EncodeToString(s.GetCode(internal))}
  passed:=true;for _,c:=range checks{passed=passed&&c.Passed}
  output:=map[string]interface{}{"passed":passed,"checks":checks,"plans":plans,"balances":balances,"codes":codes,"factoryPadding":in.FactoryPadding,"mode":"native go-quai ApplyMessage Debug=false; isolated synthetic funds only"}
  data,_:=json.MarshalIndent(output,"","  ");os.WriteFile(os.Args[2],data,0600);fmt.Printf("Native adaptation checks: %d, passed=%v\n",len(checks),passed);if !passed{os.Exit(1)};return
 }
 if in.Single {
  if len(in.Txs)!=1 || len(in.Accounts)==0 {panic("single snapshot required")}
  for _,a:=range in.Accounts {address:=common.HexToAddress(a.Address,loc);internal,e:=address.InternalAndQuaiAddress();if e!=nil{panic(e)};s.SetBalance(internal,integer(a.Balance));s.SetNonce(internal,a.Nonce);s.SetCode(internal,bytes(a.Code));for k,v:=range a.Storage{s.SetState(internal,common.HexToHash(k),common.HexToHash(v))}}
  if in.FinalizeSnapshot {
   s.IntermediateRoot(false)
   for _,a:=range in.Accounts {address:=common.HexToAddress(a.Address,loc);internal,e:=address.InternalAndQuaiAddress();if e!=nil{panic(e)};for k,v:=range a.Storage {if s.GetCommittedState(internal,common.HexToHash(k))!=common.HexToHash(v){panic("snapshot committed storage mismatch")}}}
  }
  t:=in.Txs[0];discovered:=discover(s,t,true);before:=s.Copy();o:=run(s,t,in.AccessList,false);runtime:="0x"
  if o.Error==""&&o.Contract!="" {address:=common.HexToAddress(o.Contract,loc);internal,e:=address.InternalAndQuaiAddress();if e!=nil{panic(e)};runtime="0x"+hex.EncodeToString(s.GetCode(internal))}
  lo,hi:=uint64(21000),t.Gas;if o.Error=="" {for lo+1<hi {mid:=(lo+hi)/2;p:=t;p.Gas=mid;if run(before.Copy(),p,in.AccessList,false).Error==""{hi=mid}else{lo=mid}}}
  out:=map[string]interface{}{"mode":"single pinned-state native execution; Debug=false","snapshotCommitted":in.FinalizeSnapshot,"outcome":o,"discoveredAccessList":discovered,"runtime":runtime,"minimumGas":hi,"estimate":hi+hi/3}
  data,_:=json.MarshalIndent(out,"","  ");if e:=os.WriteFile(os.Args[2],data,0600);e!=nil{panic(e)};return
 }
 plans:=[]map[string]interface{}{}
 for _,t:=range in.Txs {
  if t.Name=="transfer" {
   d:=query(s,in.Wallet,in.DigestQuery);v:=query(s,in.Wallet,in.VerifyQuery);checks=append(checks,Check{"digest matches signed challenge",d==in.ExpectedDigest,Outcome{Return:d}},Check{"native browser assertion verification",integer(v).Uint64()==1,Outcome{Return:v}})
   for _,c:=range in.SecurityCases {p:=t;p.Data=c.Data;p.Gas=8000000;a:=discover(s,p,true);o:=run(s.Copy(),p,a,false);valid:=o.Error=="" && o.Return=="0x"+strings.Repeat("0",63)+"1";rejected:=o.Error=="execution reverted" || (o.Error=="" && o.Return=="0x"+strings.Repeat("0",64));pass:=valid;if !c.Expected {pass=rejected};if c.MustRevert{pass=pass&&o.Error=="execution reverted"};checks=append(checks,Check{"WebAuthn: "+c.Name,pass,o})}
   for _,c:=range in.OperationCases {p:=t;p.Data=c.Data;a:=discover(s,p,true);check(c.Name,run(s.Copy(),p,a,false),"execution reverted")}
  }
  acl:=discover(s,t,false)
  check(t.Name+": absent list",run(s.Copy(),t,nil,false),"invalid access list")
  check(t.Name+": empty list",run(s.Copy(),t,types.AccessList{},false),"invalid access list")
  for i,a:=range acl {removed:=append(types.AccessList{},acl[:i]...);removed=append(removed,acl[i+1:]...);check(fmt.Sprintf("%s: absent address %d (native outcome)",t.Name,i),run(s.Copy(),t,removed,false),"observe");for k:=range a.StorageKeys {missing:=clone(acl);missing[i].StorageKeys=append(missing[i].StorageKeys[:k],missing[i].StorageKeys[k+1:]...);check(fmt.Sprintf("%s: absent slot %d/%d (native outcome)",t.Name,i,k),run(s.Copy(),t,missing,false),"observe")}}
  old:=t;old.Nonce--;check(t.Name+": stale nonce",run(s.Copy(),old,acl,false),"nonce too low")
  future:=t;future.Nonce++;check(t.Name+": future nonce",run(s.Copy(),future,acl,false),"nonce too high")
  if t.To=="" {changed:=t;changed.Data+="01";check(t.Name+": input changed with old ACL",run(s.Copy(),changed,acl,false),"invalid access list")}
  if t.Name=="transfer" {bad:=t;bad.Data=in.WrongReceiver;badACL:=discover(s,bad,true);check("receiver substitution",run(s.Copy(),bad,badACL,false),"execution reverted")}
  before:=s.Copy();o:=run(s,t,acl,false);check(t.Name+": complete ACL",o,"");if o.Error!=""{break};if t.To==""{expected:=in.Wallet;if t.Name=="token"{expected=in.Token};checks=append(checks,Check{t.Name+": predicted address matches native CREATE",strings.EqualFold(expected,o.Contract),Outcome{Contract:o.Contract}})};s.Finalize(true)
  lo,hi:=uint64(21000),t.Gas;for lo+1<hi {mid:=(lo+hi)/2;p:=t;p.Gas=mid;if run(before.Copy(),p,acl,false).Error==""{hi=mid}else{lo=mid}}
  plans=append(plans,map[string]interface{}{"name":t.Name,"accessList":acl,"gasUsed":o.Gas,"minimumSuccessfulGas":hi,"estimateWithThirdMargin":hi+hi/3,"contract":o.Contract})
 }
 replay:=in.Txs[len(in.Txs)-1];replay.Nonce=s.GetNonce(ia);replay.Data=in.Replay;check("replay after success",run(s.Copy(),replay,discover(s,replay,true),false),"execution reverted")
 values:=map[string]string{"walletNonce":query(s,in.Wallet,in.WalletNonce),"walletTokenBalance":query(s,in.Token,in.WalletBalance),"recipientTokenBalance":query(s,in.Token,in.RecipientBalance)}
 passed:=true;for _,c:=range checks{passed=passed&&c.Passed};passed=passed&&integer(values["walletNonce"]).Uint64()==1&&integer(values["walletTokenBalance"]).Uint64()==993&&integer(values["recipientTokenBalance"]).Uint64()==7
 result:=map[string]interface{}{"client":"go-quai v0.56.1","mode":"native core.ApplyMessage; Debug=false on all asserted executions; synthetic isolated state","passed":passed,"checks":checks,"plans":plans,"values":values,"relayerNonce":s.GetNonce(ia),"stateSize":in.StateSize,"price":in.Price}
 data,_:=json.MarshalIndent(result,"","  ");os.WriteFile(os.Args[2],data,0600);fmt.Printf("Native checks: %d, passed=%v\n",len(checks),passed);if !passed{os.Exit(1)}
}
