const DB_NAME="moldingLineSecureDB", DB_VERSION=1, STORE="records", META="meta";
let db=null, cryptoKey=null, recordsCache=[], selectedIds=new Set(), slotCount=0, rejectionCount=0;

const $=id=>document.getElementById(id);
const enc=new TextEncoder(), dec=new TextDecoder();

function msg(el,text,type=""){el.textContent=text;el.className="message "+type}
function nowISO(){return new Date().toISOString()}
function uuid(){return crypto.randomUUID?crypto.randomUUID():Date.now()+"-"+Math.random().toString(16).slice(2)}

function openDB(){
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB_NAME,DB_VERSION);
    r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains(STORE))d.createObjectStore(STORE,{keyPath:"id"});if(!d.objectStoreNames.contains(META))d.createObjectStore(META,{keyPath:"key"})};
    r.onsuccess=()=>{db=r.result;resolve(db)};r.onerror=()=>reject(r.error);
  });
}
function tx(store,mode="readonly"){return db.transaction(store,mode).objectStore(store)}
function getObj(store,key){return new Promise((res,rej)=>{const r=tx(store).get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function putObj(store,obj){return new Promise((res,rej)=>{const r=tx(store,"readwrite").put(obj);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function deleteObj(store,key){return new Promise((res,rej)=>{const r=tx(store,"readwrite").delete(key);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
function allObjs(store){return new Promise((res,rej)=>{const r=tx(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}

async function deriveKey(password,salt){
  const base=await crypto.subtle.importKey("raw",enc.encode(password),"PBKDF2",false,["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:250000,hash:"SHA-256"},base,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
async function encrypt(obj){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const data=await crypto.subtle.encrypt({name:"AES-GCM",iv},cryptoKey,enc.encode(JSON.stringify(obj)));
  return {iv:Array.from(iv),data:Array.from(new Uint8Array(data))};
}
async function decrypt(payload){
  const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:new Uint8Array(payload.iv)},cryptoKey,new Uint8Array(payload.data));
  return JSON.parse(dec.decode(plain));
}
async function makeVerifier(key){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const data=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,enc.encode("MOLDING_LINE_VAULT_OK"));
  return {iv:Array.from(iv),data:Array.from(new Uint8Array(data))};
}
async function verifyKey(key,verifier){
  try{const p=await crypto.subtle.decrypt({name:"AES-GCM",iv:new Uint8Array(verifier.iv)},key,new Uint8Array(verifier.data));return dec.decode(p)==="MOLDING_LINE_VAULT_OK"}catch{return false}
}

async function setupAuth(){
  await openDB();
  const meta=await getObj(META,"vault");
  $("setupBox").classList.toggle("hidden",!!meta);
  $("unlockBox").classList.toggle("hidden",!meta);
  $("lockStatus").textContent=meta?"Locked":"Not configured";
}
async function createVault(){
  const p=$("newPassword").value,p2=$("newPassword2").value;
  if(p.length<10)return msg($("authMessage"),"Use at least 10 characters for the encryption password.","error");
  if(p!==p2)return msg($("authMessage"),"Passwords do not match.","error");
  const salt=crypto.getRandomValues(new Uint8Array(16)), key=await deriveKey(p,salt), verifier=await makeVerifier(key);
  await putObj(META,{key:"vault",salt:Array.from(salt),verifier,createdAt:nowISO()});
  cryptoKey=key; recordsCache=[]; enterApp();
}
async function unlock(){
  const meta=await getObj(META,"vault"); if(!meta)return;
  const key=await deriveKey($("unlockPassword").value,new Uint8Array(meta.salt));
  if(!await verifyKey(key,meta.verifier))return msg($("authMessage"),"Incorrect password.","error");
  cryptoKey=key; $("unlockPassword").value=""; await loadRecords(); enterApp();
}
async function loadRecords(){
  const rows=await allObjs(STORE);recordsCache=[];
  for(const row of rows){try{recordsCache.push(await decrypt(row.payload))}catch{}}
  recordsCache.sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||""));
}
function enterApp(){
  $("loginCard").classList.add("hidden");$("appContent").classList.remove("hidden");
  $("lockStatus").textContent="Unlocked";$("lockStatus").className="status-pill unlocked";
  if(!$("slotList").children.length)addSlot();
}
function lockApp(){
  cryptoKey=null;recordsCache=[];selectedIds.clear();$("appContent").classList.add("hidden");$("loginCard").classList.remove("hidden");
  $("lockStatus").textContent="Locked";$("lockStatus").className="status-pill locked";setupAuth();
}
function collectHeader(){
  const val=id=>$(id).value.trim();
  return {date:val("reportDate"),shift:val("shift"),product:val("product"),weight:val("weight"),startTime:val("startTime"),endTime:val("endTime"),
    zellers:$("zellers").checked,kriolloMilky:$("kriolloMilky").checked,
    chocolateBatch:val("chocolateBatch"),chocolateViscosity:val("chocolateViscosity"),chocolateMoisture:val("chocolateMoisture"),
    creamType:val("creamType"),creamBatch:val("creamBatch"),creamViscosity:val("creamViscosity"),creamColor:val("creamColor"),creamTaste:val("creamTaste"),
    insertion1:{type:val("ins1Type"),batch:val("ins1Batch"),percent:val("ins1Percent"),taste:val("ins1Taste")},
    insertion2:{type:val("ins2Type"),batch:val("ins2Batch"),percent:val("ins2Percent"),taste:val("ins2Taste")}};
}
function collectSlots(){
  return [...document.querySelectorAll(".slot-card")].map(card=>({
    time:card.querySelector(".s-time").value,tempering:card.querySelector(".s-tempering").value,speed:card.querySelector(".s-speed").value,
    tank:card.querySelector(".s-tank").value,mold:card.querySelector(".s-mold").value,dep1:card.querySelector(".s-dep1").value,dep2:card.querySelector(".s-dep2").value,
    dep3:card.querySelector(".s-dep3").value,cooling:card.querySelector(".s-cooling").value,z1:card.querySelector(".s-z1").value,z2:card.querySelector(".s-z2").value,z3:card.querySelector(".s-z3").value,
    zinC:card.querySelector(".s-zin-c").value,zinP:card.querySelector(".s-zin-p").value,zoutC:card.querySelector(".s-zout-c").value,zoutP:card.querySelector(".s-zout-p").value,
    vib:card.querySelector(".s-vib").value,side:card.querySelector(".s-side").value,
    metal:{fe:card.querySelector(".s-fe").checked,nonfe:card.querySelector(".s-nonfe").checked,ss:card.querySelector(".s-ss").checked}
  })).sort((a,b)=>a.time.localeCompare(b.time));
}
function collectRejections(){
  return [...document.querySelectorAll(".rejection-row")].map(r=>({nc:r.querySelector(".r-nc").value,issue:r.querySelector(".r-issue").value,cause:r.querySelector(".r-cause").value,action:r.querySelector(".r-action").value})).filter(x=>Object.values(x).some(Boolean));
}
async function saveReport(e){
  e.preventDefault();
  const slots=collectSlots();if(!slots.length)return msg($("saveMessage"),"Add at least one time slot.","error");
  if(slots.some(s=>!s.time))return msg($("saveMessage"),"Every time slot must have a time.","error");
  const report={id:uuid(),createdAt:nowISO(),...collectHeader(),slots,rejections:collectRejections()};
  await putObj(STORE,{id:report.id,payload:await encrypt(report)});
  recordsCache.unshift(report);recordsCache.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  msg($("saveMessage"),`Saved securely at ${new Date(report.createdAt).toLocaleString()}. Record ID: ${report.id}`,"ok");
  renderResults(filterRecords());
}
function addSlot(data={}){
  slotCount++;
  const node=$("slotTemplate").content.cloneNode(true),card=node.querySelector(".slot-card");
  card.querySelector(".slot-number").textContent=slotCount;
  const map={".s-time":"time",".s-tempering":"tempering",".s-speed":"speed",".s-tank":"tank",".s-mold":"mold",".s-dep1":"dep1",".s-dep2":"dep2",".s-dep3":"dep3",".s-cooling":"cooling",".s-z1":"z1",".s-z2":"z2",".s-z3":"z3",".s-zin-c":"zinC",".s-zin-p":"zinP",".s-zout-c":"zoutC",".s-zout-p":"zoutP"};
  for(const [sel,key] of Object.entries(map))card.querySelector(sel).value=data[key]||"";
  card.querySelector(".s-vib").value=data.vib||"ON";card.querySelector(".s-side").value=data.side||"ON";
  card.querySelector(".s-fe").checked=!!data.metal?.fe;card.querySelector(".s-nonfe").checked=!!data.metal?.nonfe;card.querySelector(".s-ss").checked=!!data.metal?.ss;
  card.querySelector(".remove-slot").onclick=()=>{card.remove();renumberSlots()};
  $("slotList").appendChild(card);
}
function renumberSlots(){[...document.querySelectorAll(".slot-card")].forEach((c,i)=>c.querySelector(".slot-number").textContent=i+1);slotCount=document.querySelectorAll(".slot-card").length}
function addRejection(data={}){
  rejectionCount++;const node=$("rejectionTemplate").content.cloneNode(true),row=node.querySelector(".rejection-row");
  row.querySelector(".r-nc").value=data.nc||"";row.querySelector(".r-issue").value=data.issue||"";row.querySelector(".r-cause").value=data.cause||"";row.querySelector(".r-action").value=data.action||"";
  row.querySelector(".remove-rejection").onclick=()=>row.remove();$("rejectionList").appendChild(row);
}
function clearForm(){
  $("reportForm").reset();$("slotList").innerHTML="";$("rejectionList").innerHTML="";slotCount=0;rejectionCount=0;addSlot();$("reportDate").value=new Date().toISOString().slice(0,10);
}
function filterRecords(){
  const date=$("searchDate").value,from=$("searchFrom").value,to=$("searchTo").value,q=$("searchText").value.trim().toLowerCase();
  const out=[];
  for(const r of recordsCache){
    if(date&&r.date!==date)continue;
    if(q&&!`${r.product} ${r.shift} ${r.id}`.toLowerCase().includes(q))continue;
    for(const s of r.slots){
      if(from&&s.time<from)continue;if(to&&s.time>to)continue;
      out.push({report:r,slot:s});
    }
  }
  out.sort((a,b)=>(a.report.date+a.slot.time).localeCompare(b.report.date+b.slot.time));
  return out;
}
function renderResults(results){
  $("recordSummary").textContent=`${results.length} time slot(s) found. ${selectedIds.size} selected for PDF.`;
  const body=$("recordsTable").querySelector("tbody");body.innerHTML="";
  for(const item of results){
    const id=item.report.id+"|"+item.slot.time;
    const tr=document.createElement("tr");
    tr.innerHTML=`<td><input class="table-select" type="checkbox" ${selectedIds.has(id)?"checked":""}></td>
      <td>${esc(item.report.date)}</td><td>${esc(item.slot.time)}</td><td>${esc(item.report.product)}</td><td>${esc(item.report.shift)}</td>
      <td>${esc(item.slot.speed)}</td><td>${esc(item.slot.tank)}</td><td>${esc(item.slot.zoutC)}</td>
      <td>${esc(new Date(item.report.createdAt).toLocaleString())}</td><td><button class="btn secondary small">View</button></td>`;
    tr.querySelector(".table-select").onchange=e=>{e.target.checked?selectedIds.add(id):selectedIds.delete(id);renderResults(filterRecords())};
    tr.querySelector("button").onclick=()=>showDetail(item.report,item.slot);
    body.appendChild(tr);
  }
}
function esc(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]))}
function showDetail(r,s){
  $("recordDetail").classList.remove("hidden");
  $("recordDetail").innerHTML=`<div class="section-title"><div><h2>Record Detail</h2><p>${esc(r.date)} • ${esc(s.time)} • ${esc(r.product)}</p></div></div>
  <div class="detail-grid">${[
  ["Record ID",r.id],["Shift",r.shift],["Weight",r.weight],["Chocolate Batch",r.chocolateBatch],["Chocolate Viscosity",r.chocolateViscosity],["Chocolate Moisture",r.chocolateMoisture],
  ["Tempering",s.tempering],["Line Speed",s.speed],["Tank °C",s.tank],["Mold °C",s.mold],["Depositor 1",s.dep1],["Depositor 2",s.dep2],["Depositor 3",s.dep3],
  ["Zone 01",s.z1],["Zone 02",s.z2],["Zone 03",s.z3],["Zone In °C",s.zinC],["Zone In %",s.zinP],["Zone Out °C",s.zoutC],["Zone Out %",s.zoutP],
  ["Vibrator",s.vib],["Side Vibration",s.side],["Metal Fe",s.metal.fe?"Checked":"—"],["Metal Non-Fe",s.metal.nonfe?"Checked":"—"],["Metal SS",s.metal.ss?"Checked":"—"]
  ].map(x=>`<div class="detail-item"><b>${esc(x[0])}</b><br>${esc(x[1])}</div>`).join("")}</div>`;
  $("recordDetail").scrollIntoView({behavior:"smooth"});
}
function buildPrintReport(items){
  if(!items.length)return msg($("saveMessage"),"Select at least one time slot for PDF/printing.","error");
  const groups=new Map();
  items.forEach(x=>{if(!groups.has(x.report.id))groups.set(x.report.id,{report:x.report,slots:[]});groups.get(x.report.id).slots.push(x.slot)});
  let html=`<div class="print-report"><h1>MALIBAN BISCUIT MANUFACTORIES (PVT.) LIMITED</h1><div style="text-align:center;font-size:10px">QUALITY ASSURANCE, RESEARCH & DEVELOPMENT DEPARTMENT<br><b>TITLE: PROCESS REPORT - MOLDING LINE</b></div>`;
  for(const g of groups.values()){
    const r=g.report;
    html+=`<h2>Report Information</h2><div class="meta">
    <div><b>Date</b><br>${esc(r.date)}</div><div><b>Shift</b><br>${esc(r.shift)}</div><div><b>Product</b><br>${esc(r.product)}</div><div><b>Weight</b><br>${esc(r.weight)}</div>
    <div><b>Start</b><br>${esc(r.startTime)}</div><div><b>End</b><br>${esc(r.endTime)}</div><div><b>Chocolate Batch</b><br>${esc(r.chocolateBatch)}</div><div><b>Chocolate Viscosity</b><br>${esc(r.chocolateViscosity)}</div>
    <div><b>Chocolate Moisture</b><br>${esc(r.chocolateMoisture)}</div><div><b>Cream Type</b><br>${esc(r.creamType)}</div><div><b>Cream Batch</b><br>${esc(r.creamBatch)}</div><div><b>Cream Viscosity</b><br>${esc(r.creamViscosity)}</div>
    </div><h2>Time-Slot Measurements</h2><table><thead><tr><th>Time</th><th>Temp. Index</th><th>Speed</th><th>Tank °C</th><th>Mold °C</th><th>Dep.1</th><th>Dep.2</th><th>Dep.3</th><th>Cooling</th><th>Z1</th><th>Z2</th><th>Z3</th><th>In °C/%</th><th>Out °C/%</th><th>Vib</th><th>Side</th><th>Metal</th></tr></thead><tbody>`;
    g.slots.sort((a,b)=>a.time.localeCompare(b.time)).forEach(s=>{
      const m=[s.metal.fe?"Fe":"",s.metal.nonfe?"Non-Fe":"",s.metal.ss?"SS":""].filter(Boolean).join(", ")||"—";
      html+=`<tr><td>${esc(s.time)}</td><td>${esc(s.tempering)}</td><td>${esc(s.speed)}</td><td>${esc(s.tank)}</td><td>${esc(s.mold)}</td><td>${esc(s.dep1)}</td><td>${esc(s.dep2)}</td><td>${esc(s.dep3)}</td><td>${esc(s.cooling)}</td><td>${esc(s.z1)}</td><td>${esc(s.z2)}</td><td>${esc(s.z3)}</td><td>${esc(s.zinC)}/${esc(s.zinP)}</td><td>${esc(s.zoutC)}/${esc(s.zoutP)}</td><td>${esc(s.vib)}</td><td>${esc(s.side)}</td><td>${esc(m)}</td></tr>`;
    });
    html+=`</tbody></table>`;
    if(r.rejections?.length){html+=`<h2>Any Rejection / NC</h2><table><thead><tr><th>NC Number</th><th>Issue</th><th>Root Cause</th><th>Corrective Action</th></tr></thead><tbody>${r.rejections.map(x=>`<tr><td>${esc(x.nc)}</td><td>${esc(x.issue)}</td><td>${esc(x.cause)}</td><td>${esc(x.action)}</td></tr>`).join("")}</tbody></table>`}
    html+=`<p class="small">Record ID: ${esc(r.id)} • Saved: ${esc(new Date(r.createdAt).toLocaleString())}</p>`;
  }
  html+=`<p class="small">Generated: ${esc(new Date().toLocaleString())}</p></div>`;
  $("printArea").innerHTML=html;window.print();
}
function selectedItems(){
  return filterRecords().filter(x=>selectedIds.has(x.report.id+"|"+x.slot.time));
}

document.addEventListener("DOMContentLoaded",async()=>{
  try{await setupAuth()}catch(e){msg($("authMessage"),"Browser storage is unavailable or blocked. Use a normal HTTPS/localhost page.","error")}
  $("createVaultBtn").onclick=createVault;$("unlockBtn").onclick=unlock;$("lockBtn").onclick=lockApp;
  $("newPassword2").addEventListener("keydown",e=>{if(e.key==="Enter")createVault()});
  $("unlockPassword").addEventListener("keydown",e=>{if(e.key==="Enter")unlock()});
  document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));document.querySelectorAll(".tab-panel").forEach(x=>x.classList.remove("active"));b.classList.add("active");$(b.dataset.tab).classList.add("active")});
  $("addSlotBtn").onclick=()=>addSlot();$("addRejectionBtn").onclick=()=>addRejection();$("reportForm").onsubmit=saveReport;$("resetFormBtn").onclick=clearForm;
  $("searchBtn").onclick=()=>renderResults(filterRecords());
  $("clearSearchBtn").onclick=()=>{$("searchDate").value="";$("searchFrom").value="";$("searchTo").value="";$("searchText").value="";selectedIds.clear();renderResults(filterRecords())};
  $("allDateBtn").onclick=()=>{const d=$("searchDate").value;if(!d)return alert("Select a date first.");selectedIds.clear();filterRecords().filter(x=>x.report.date===d).forEach(x=>selectedIds.add(x.report.id+"|"+x.slot.time));renderResults(filterRecords())};
  $("printSelectedBtn").onclick=()=>buildPrintReport(selectedItems());
  $("reportDate").value=new Date().toISOString().slice(0,10);
});
