// Fictional presentation data only. No account IDs, backend calls or persistence.
export const storyData={
 fictional:true,
 rules:{helpful:1,notHelpful:-1,bestAnswer:5,debatePositive:.25,debateNegative:-.25},
 daniel:{name:'Daniel Carter',role:'Accountant',years:5},
 question:"I'm buying an old house. What should I check that the seller might not tell me?",
 answer:"Don't just look at the cracks. Look for areas that were recently painted — fresh paint can hide damp, water stains, or cracking. And always check the area's flood history. The house may look perfect today, but water may have been inside before.",
 people:[['Builder',41,'Old buildings & restoration'],['Nurse',24,'Patient care'],['Truck Driver',31,'Long-distance transport'],['Gardener',38,'Plants & soil'],['Angler',27,'River fishing'],['Home Cook',35,'Traditional cooking'],['Amateur Astronomer',18,'Night sky observation'],['Classic Car Enthusiast',29,'Restoration & maintenance'],['Hiker',22,'Mountain hiking'],['Beekeeper',16,'Beekeeping'],['Chess Player',19,'Chess'],['Guitarist',26,'Playing guitar'],['Mushroom Forager',32,'Mushroom foraging']],
 responders:[['Builder',41],['Plumber',17],['Roofer',19],['Bricklayer',34],['Damp & Timber Specialist',26],['Building Surveyor',22],['Electrician',14],['Heating Engineer',23],['DIY Renovator',12],['Structural Engineer',28],['Drainage Specialist',31],['Window Installer',9],['Historic Building Restorer',18],['Property Renovator',36],['Plasterer',21],['Home Inspector',15]],
 responses:[{member:0,fragment:'Fresh paint can hide more than cracks.',helpful:8},{member:3,fragment:'Ask what changed after the last heavy rain.',helpful:6},{member:15,mobileMember:6,fragment:'Check the roof space for old water stains.',helpful:5}],
 builderReputationBeforeChoice:84
};
export const storyScenes=[
 {at:0,label:'NEURON STORM',title:'Human knowledge\nlives everywhere.',body:'Behind every connection, a person.'},
 {at:.08,label:'01 / PEOPLE FROM AROUND THE WORLD',title:'Every person holds knowledge.',body:'From work, hobbies and a lifetime of experience.'},
 {at:.20,label:'02 / SOMEONE NEEDS AN ANSWER',title:storyData.question,body:'Daniel Carter · Accountant · 5 years experience',note:'A question for people who know what problems a house can hide.'},
 {at:.30,label:'03 / THE DEBATE BEGINS',title:'One question.\nMany kinds of experience.',body:'Professional skills. Personal experience. Shared knowledge.',note:'Relevant people notice the question. Responses begin to appear.'},
 {at:.41,label:'04 / COMMUNITY CHOICE',title:'The community highlights the most helpful answers.',body:'Helpful +1 · Not Helpful −1',note:'These are ratings on answers. Daniel makes the final Best Answer choice.'},
 {at:.50,label:"05 / THE COMMUNITY'S MOST LIKED ANSWERS",title:'Three answers stood out.',body:'Human experience finds its way back to Daniel.'},
 {at:.59,label:'06 / AN ANSWER THAT HELPED',title:'Daniel chose the answer that truly helped him.',body:''},
 {at:.70,label:'07 / KNOWLEDGE BUILDS REPUTATION',title:'His experience helped Daniel — and earned recognition.',body:''},
 {at:.77,label:'HUMAN KNOWLEDGE CREATES VALUE',title:'Useful contributions create value.',body:'Weekly Score → Weekly Ranking → NS Rewards',note:'Recognition starts with sharing what you know.'},
 {at:.84,label:'',title:'One question can unlock decades of experience.',body:"Someone already knows what you don't."},
 {at:.92,label:'',title:'Turn your experience into value.',body:''}
];
export function storyPhase(p){return {question:Math.max(0,Math.min(1,(p-.215)/.065)),spread:Math.max(0,Math.min(1,(p-.28)/.10)),returning:Math.max(0,Math.min(1,(p-.515)/.065)),chosen:p>=.665,bonus:Math.max(0,Math.min(1,(p-.71)/.035))};}

export function topAnswerMember(answer,mobile=false){return mobile?(answer.mobileMember??answer.member):answer.member;}
