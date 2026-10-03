export function suggestionPlacement(rect,viewport){
  const top=viewport.top+8,bottom=viewport.top+viewport.height-8;
  const below=Math.max(0,bottom-rect.bottom-6),above=Math.max(0,rect.top-top-6);
  const upward=below<132&&above>below,height=Math.min(220,upward?above:below);
  return {upward,left:Math.max(viewport.left+8,Math.min(rect.left,viewport.left+viewport.width-rect.width-8)),top:upward?rect.top-6-height:rect.bottom+6,width:Math.min(rect.width,viewport.width-16),height};
}
export function createTopicSuggestions(input,list,getNames){
  let matches=[],active=-1;
  document.body.append(list);
  input.removeAttribute('list');input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',list.id);input.setAttribute('aria-expanded','false');
  function close(){list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;}
  function position(){
    if(list.hidden)return;const v=window.visualViewport,rect=input.getBoundingClientRect();
    const viewport={top:v?.offsetTop||0,left:v?.offsetLeft||0,width:v?.width||innerWidth,height:v?.height||innerHeight};
    if(rect.bottom<viewport.top||rect.top>viewport.top+viewport.height){close();return;}
    const box=suggestionPlacement(rect,viewport);if(box.height<40){close();return;}
    Object.assign(list.style,{left:box.left+'px',top:box.top+'px',width:box.width+'px',maxHeight:box.height+'px'});
    if(box.upward)list.style.top=(rect.top-6-Math.min(box.height,list.scrollHeight+2))+'px';
  }
  function choose(index){if(!matches[index])return;input.value=matches[index].name;close();input.focus({preventScroll:true});}
  function refresh(){
    if(document.activeElement!==input)return;
    const query=input.value.normalize('NFKC').trim().toLocaleLowerCase();
    matches=getNames().filter(({name})=>name.normalize('NFKC').toLocaleLowerCase().includes(query)).slice(0,50);active=-1;list.replaceChildren();input.removeAttribute('aria-activedescendant');
    matches.forEach(({name,memberCount},index)=>{const option=document.createElement('div');option.id=list.id+'-'+index;option.setAttribute('role','option');option.setAttribute('aria-selected','false');option.textContent=name+' · '+memberCount+(memberCount===1?' member':' members');option.addEventListener('pointerdown',e=>e.preventDefault());option.addEventListener('click',()=>choose(index));list.append(option);});
    list.hidden=!matches.length;input.setAttribute('aria-expanded',String(!!matches.length));position();
  }
  input.addEventListener('input',refresh);input.addEventListener('focus',refresh);input.addEventListener('blur',close);
  input.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();close();return;}
    if(list.hidden)return;
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();active=(active+(event.key==='ArrowDown'?1:-1)+matches.length)%matches.length;
      [...list.children].forEach((el,i)=>el.setAttribute('aria-selected',String(i===active)));
      input.setAttribute('aria-activedescendant',list.children[active].id);list.children[active].scrollIntoView({block:'nearest'});
    }else if(event.key==='Enter'&&active>=0){event.preventDefault();event.stopImmediatePropagation();choose(active);}
  });
  window.addEventListener('resize',position);window.addEventListener('scroll',position,true);
  window.visualViewport?.addEventListener('resize',position);window.visualViewport?.addEventListener('scroll',position);
  close();return {refresh,close};
}
