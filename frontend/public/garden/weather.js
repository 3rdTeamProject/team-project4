'use strict';
// Open-Meteo current model data. Public non-commercial endpoint; no API key.
// Coordinates are approximate region reference points, not the user's farm address.
const GardenWeather=(()=>{
  const TTL=10*60*1000, cache=new Map(), pending=new Map();
  const regions={
    '경기 양평군':{latitude:37.489,longitude:127.49,label:'경기 양평군 · 양평읍 기준'},
    '경기도 양평군':{latitude:37.489,longitude:127.49,label:'경기 양평군 · 양평읍 기준'},
    '서울 마포구':{latitude:37.56656,longitude:126.89929,label:'서울 마포구 · 지역 기준'},
    '서울특별시 마포구':{latitude:37.56656,longitude:126.89929,label:'서울 마포구 · 지역 기준'},
    '경북 안동시':{latitude:36.56636,longitude:128.72275,label:'경북 안동시 · 지역 기준'},
    '경상북도 안동시':{latitude:36.56636,longitude:128.72275,label:'경북 안동시 · 지역 기준'}
  };
  const provinces={경기:'경기도',서울:'서울특별시',경북:'경상북도',경남:'경상남도',충북:'충청북도',충남:'충청남도',전북:'전라북도',전남:'전라남도',강원:'강원도',제주:'제주도',부산:'부산광역시',인천:'인천광역시',대전:'대전광역시',대구:'대구광역시',광주:'광주광역시',울산:'울산광역시'};
  const aliases={서울:'Seoul',부산:'Busan',인천:'Incheon',대구:'Daegu',대전:'Daejeon',광주:'Gwangju',울산:'Ulsan',제주:'Jeju'};
  const valid=p=>p&&Number.isFinite(p.latitude)&&Math.abs(p.latitude)<=90&&Number.isFinite(p.longitude)&&Math.abs(p.longitude)<=180;
  const key=f=>JSON.stringify([f.id,f.region,valid(f.weatherLocation)?f.weatherLocation:null]);
  function describe(code,isDay=1){
    if(code===0||code===1)return {theme:'sun',icon:isDay?'☀':'☾',label:code===0?'맑음':'대체로 맑음'};
    if(code===2||code===3)return {theme:'cloud',icon:'☁',label:code===2?'구름 조금':'흐림'};
    if(code===45||code===48)return {theme:'fog',icon:'≋',label:'안개'};
    if([71,73,75,77,85,86].includes(code))return {theme:'snow',icon:'❄',label:'눈'};
    if([95,96,97,99].includes(code))return {theme:'rain',icon:'ϟ',label:'뇌우'};
    if([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code))return {theme:'rain',icon:'☂',label:[51,53,55,56,57].includes(code)?'이슬비':'비'};
    return {theme:'unknown',icon:'—',label:'날씨 정보 없음'};
  }
  async function json(url){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try{const r=await fetch(url,{signal:controller.signal,credentials:'omit'});if(!r.ok)throw new Error('날씨 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.');const data=await r.json();if(data.error)throw new Error('날씨 정보를 불러오지 못했어요.');return data}
    finally{clearTimeout(timer)}
  }
  async function resolve(f){
    if(valid(f.weatherLocation))return {place:f.weatherLocation};
    const region=f.region.trim().replace(/\s+/g,' ');
    if(regions[region])return {place:regions[region]};
    if(!region)throw new Error('농장 수정에서 지역을 입력하거나 농장에서 현재 위치를 지정해 주세요.');
    const parts=region.split(' '),province=parts.length>1?(provinces[parts[0]]||parts[0]):null;
    const town=parts.at(-1),names=[aliases[town]||town];
    if(/[시군구]$/.test(town)&&town.length>2)names.push(town.slice(0,-1));
    for(const name of names){
      const url=new URL('https://geocoding-api.open-meteo.com/v1/search');url.search=new URLSearchParams({name,count:'10',language:'ko',countryCode:'KR'});
      const data=await json(url);
      const results=(data.results||[]).filter(p=>valid(p)&&p.country_code==='KR'&&(!province||p.admin1===province));
      const choices=results.map(p=>({latitude:p.latitude,longitude:p.longitude,label:[p.admin1,p.admin2,p.name].filter((v,i,a)=>v&&a.indexOf(v)===i).join(' ')+' · 지역 기준'}));
      if(choices.length===1)return {place:choices[0]};
      if(choices.length>1)return {choices:choices.slice(0,5)};
    }
    throw new Error('이 지역의 위치를 찾지 못했어요. 지역명을 수정하거나 농장에서 현재 위치를 지정해 주세요.');
  }
  function peek(f){return cache.get(key(f))}
  async function load(f,force=false){
    const k=key(f),old=cache.get(k);
    if(pending.has(k))return pending.get(k);
    if(!force&&old&&Date.now()-old.at<(old.status==='error'?60000:TTL))return old;
    const task=(async()=>{
      try{
        const found=await resolve(f);
        if(found.choices){const item={status:'choose',choices:found.choices,at:Date.now()};cache.set(k,item);return item}
        const url=new URL('https://api.open-meteo.com/v1/forecast');url.search=new URLSearchParams({latitude:String(found.place.latitude),longitude:String(found.place.longitude),current:'temperature_2m,relative_humidity_2m,weather_code,is_day',timezone:'Asia/Seoul',forecast_days:'1'});
        const data=await json(url),c=data.current;
        if(!c||!Number.isFinite(c.temperature_2m)||!Number.isInteger(c.weather_code)||typeof c.time!=='string'||!Number.isFinite(Date.parse(c.time+'+09:00')))throw new Error('날씨 응답이 올바르지 않아요. 다시 시도해 주세요.');
        if(Math.abs(Date.now()-Date.parse(c.time+'+09:00'))>90*60*1000)throw new Error('최신 날씨 정보가 아직 없어요. 잠시 후 다시 시도해 주세요.');
        const item={status:'ready',at:Date.now(),place:found.place,current:c,...describe(c.weather_code,c.is_day)};cache.set(k,item);return item;
      }catch(e){const item={status:'error',at:Date.now(),message:e.name==='AbortError'?'날씨 조회 시간이 초과됐어요. 다시 시도해 주세요.':e instanceof TypeError?'인터넷 연결을 확인한 뒤 다시 시도해 주세요.':e.message};cache.set(k,item);return item}
      finally{pending.delete(k)}
    })();pending.set(k,task);return task;
  }
  return {load,peek,key,describe,valid};
})();
