import {AccessToken,RoomServiceClient,TrackSource} from 'livekit-server-sdk';

export function configuredLiveTalk(env=process.env){
 if(!env.LIVEKIT_URL||!env.LIVEKIT_API_KEY||!env.LIVEKIT_API_SECRET)return null;
 const url=new URL(env.LIVEKIT_URL);
 if(url.protocol!=='wss:'||!url.hostname.endsWith('.livekit.cloud')||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('Invalid Live Talk configuration');
 const client=new RoomServiceClient(url.origin.replace('wss:','https:'),env.LIVEKIT_API_KEY,env.LIVEKIT_API_SECRET,{requestTimeout:5,failover:false});
 // Room recording, agents, ingress and egress APIs are deliberately not exposed.
 const permission=canPublish=>({canPublish,canSubscribe:true,canPublishData:false,canUpdateOwnMetadata:false,canPublishSources:[TrackSource.MICROPHONE]});
 return {
  url:url.origin,
  async create(room){await client.createRoom({name:room,maxParticipants:10,emptyTimeout:30,departureTimeout:10});},
  async removeRoom(room){try{await client.deleteRoom(room);}catch(e){if(e.code!=='not_found'&&e.status!==404)throw e;}},
  async participants(room){try{return await client.listParticipants(room);}catch(e){if(e.code==='not_found'||e.status===404)return [];throw e;}},
  async permission(room,identity,publish){await client.updateParticipant(room,identity,{permission:permission(publish)});},
  async remove(room,identity){try{await client.removeParticipant(room,identity);}catch(e){if(e.code!=='not_found'&&e.status!==404)throw e;}},
  async token(room,identity){
   const token=new AccessToken(env.LIVEKIT_API_KEY,env.LIVEKIT_API_SECRET,{identity,ttl:30});
   token.addGrant({room,roomJoin:true,...permission(false)});
   return token.toJwt();
  },
 };
}
