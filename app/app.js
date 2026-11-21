/* SikaBook — church & organization finance (Supabase + vanilla JS) */
'use strict';

/* ===================== Setup ===================== */
const CFG = window.SIKABOOK_CONFIG || {};
const sb = window.supabase.createClient(CFG.url, CFG.key);
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = v => Number(v) || 0;
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const todayISO = () => new Date().toLocaleDateString('en-CA');
const NOW = new Date(), YEAR = NOW.getFullYear(), MONTH = NOW.getMonth();
const ym = d => d.slice(0,7);
const dShort = iso => iso ? `${+iso.slice(8,10)} ${MONTHS[+iso.slice(5,7)-1]}` : '';
const dLong = iso => iso ? `${+iso.slice(8,10)} ${MONTHS[+iso.slice(5,7)-1]} ${iso.slice(0,4)}` : '';

const CURRENCIES = [['GHS','GH₵','Ghana cedi'],['NGN','₦','Nigerian naira'],['USD','$','US dollar'],['GBP','£','British pound'],['EUR','€','Euro'],['CAD','C$','Canadian dollar'],['KES','KSh','Kenyan shilling'],['ZAR','R','South African rand'],['XOF','CFA','West African CFA franc']];
const DAYS = [
  {d:'Sunday',m:'Kwasi',f:'Akosua'},{d:'Monday',m:'Kwadwo',f:'Adwoa'},{d:'Tuesday',m:'Kwabena',f:'Abena'},
  {d:'Wednesday',m:'Kwaku',f:'Akua'},{d:'Thursday',m:'Yaw',f:'Yaa'},{d:'Friday',m:'Kofi',f:'Afua'},
  {d:'Saturday',m:'Kwame',f:'Amma'},{d:'Unknown',m:'No day name',f:''}];
const TERMS = {
  church:{top:'Station', sub:'Society', subs:'societies', all:'Whole station', higher:['Circuit','District','National'], tithe:'Tithe', thanks:'Thanksgiving',
    income:['Offering','Tithe','Thanksgiving','Monthly dues','Welfare dues','Funeral dues','Harvest','Contribution','Fundraising','Other'],
    roles:{admin:'Super admin',finsec:'Financial Secretary',treasurer:'Treasurer',viewer:'Viewer'}},
  org:{top:'Head office', sub:'Department', subs:'departments', all:'Whole organization', higher:['Region','Country','Group'], tithe:'Monthly contributions', thanks:'Special donations',
    income:['Donations','Monthly contributions','Special donations','Monthly dues','Welfare dues','Sales','Grants','Fundraising','Other'],
    roles:{admin:'Super admin',finsec:'Finance officer (approver)',treasurer:'Treasurer',viewer:'Viewer'}},
};
const FUNDS = ['General fund','Day Born fund','Welfare fund','Building fund','Harvest fund'];

/* ===================== State ===================== */
const S = {
  session:null, user:null, orgs:[], org:null, me:null, loading:true, authMode:'signin', authMsg:'', recovery:false,
  units:[], orgUsers:[], invites:[], members:[], mu:[], txs:[], counts:[], budgets:[], targets:[], payees:[], lines:[], expenses:[], camps:[], pledges:[], logs:[],
  services:[], programs:[], service:null, program:null, svcTab:'services', svcDraft:{}, photo:null,
  view:'all', tab:'home', member:null, payee:null, group:null, camp:null, q:'', showAll:false, showOwing:false, spendKind:'all', editB:null,
  sunday:DAYS.map(()=>''), sheet:null, forcePhone:false, showHigher:false, reportMonth: todayISO().slice(0,7), busy:false,
};
const C = () => TERMS[S.org?.kind || 'church'];
const curSym = () => (CURRENCIES.find(c=>c[0]===S.org?.currency)||CURRENCIES[0])[1];
const fmt = n => (n<0?'−':'') + curSym() + ' ' + Math.abs(Math.round(num(n)*100)/100).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:2});
const short = v => Math.abs(v)>=1000 ? (v/1000).toFixed(Math.abs(v)%1000?1:0)+'k' : String(Math.round(v));
const feat = k => !!(S.org?.features||{})[k];
const role = () => S.me?.role || 'viewer';
const isApprover = () => ['admin','finsec'].includes(role());
const isAdmin = () => role()==='admin';
const canWrite = () => ['admin','finsec','treasurer'].includes(role());
const unitById = id => S.units.find(u=>u.id===id);
const uName = id => unitById(id)?.name || '—';
const mainUnit = () => S.units.find(u=>u.is_main);
const childrenOf = id => S.units.filter(u=>u.parent_id===id);
function descendants(id){ const out=[id]; for(let i=0;i<out.length;i++) childrenOf(out[i]).forEach(c=>out.push(c.id)); return out; }
const scope = () => S.view==='all' ? S.units.map(u=>u.id) : descendants(S.view);
const inScope = u => scope().includes(u);
const scopeLabel = () => S.view==='all' ? (S.units.length>1 ? C().all : (S.units[0]?.name||'')) : uName(S.view);
const canDayBorn = () => S.org?.kind==='church' && feat('dayborn') && mainUnit() && inScope(mainUnit().id);
const isDesk = () => window.innerWidth>=900 && !S.forcePhone;
const counted = e => !e.voided && (e.status==='approved' || e.status==='confirmed');
const liveTx = () => S.txs.filter(t=>!t.voided);
const memberName = id => S.members.find(m=>m.id===id)?.full_name || '';
const dayLabel = m => { const D=DAYS.find(x=>x.d===m.day_born); if(!D) return ''; if(D.d==='Unknown') return 'Day not known'; return m.gender==='F'?D.f:(m.gender==='M'?D.m:`${D.m}/${D.f}`); };
const ROLE_LABEL = r => C().roles[r] || r;

function balanceOf(ids){
  const open = S.units.filter(u=>ids.includes(u.id)).reduce((s,u)=>s+num(u.opening_balance),0);
  const inc = liveTx().filter(t=>ids.includes(t.unit_id)).reduce((s,t)=>s+num(t.amount),0);
  const out = S.expenses.filter(e=>ids.includes(e.unit_id)&&counted(e)).reduce((s,e)=>s+num(e.amount),0);
  return open+inc-out;
}
function balanceBefore(ids, iso){ // balance at start of a date
  const open = S.units.filter(u=>ids.includes(u.id)).reduce((s,u)=>s+num(u.opening_balance),0);
  const inc = liveTx().filter(t=>ids.includes(t.unit_id)&&t.txn_date<iso).reduce((s,t)=>s+num(t.amount),0);
  const out = S.expenses.filter(e=>ids.includes(e.unit_id)&&counted(e)&&e.exp_date<iso).reduce((s,e)=>s+num(e.amount),0);
  return open+inc-out;
}
const writableUnits = () => canWrite() ? S.units : [];
const sumAmt = arr => arr.reduce((s,x)=>s+num(x.amount),0);

/* ---- Services & programs helpers ---- */
const isChurch = () => S.org?.kind==='church';
const svcItems = () => { const f=S.org?.features||{}; return Array.isArray(f.service_items)&&f.service_items.length ? f.service_items : (isChurch()?['Offering','Thanksgiving','Fundraising','Day Born']:['Donations','Special donations','Fundraising']); };
const svcKinds = () => { const f=S.org?.features||{}; return Array.isArray(f.service_kinds)&&f.service_kinds.length ? f.service_kinds : (isChurch()?['Sunday service','Evening service','Midweek service','Prayer meeting','Special service']:['Meeting','Event','Other']); };
const progFields = () => ({theme:true,speakers:true,team:true,venue:true,...((S.org?.features||{}).program_fields||{})});
const PROG_LABEL = {theme:'Theme',speakers:'Speakers',team:'Organising team',venue:'Venue'};
const svcById = id => S.services.find(s=>s.id===id);
const progById = id => S.programs.find(p=>p.id===id);
const svcName = s => s ? `${s.title||s.kind} · ${dShort(s.service_date)}` : '';
const svcTx = id => liveTx().filter(t=>t.service_id===id);
const svcEx = id => S.expenses.filter(e=>e.service_id===id&&!e.voided&&e.status!=='rejected');
const inProg = (row,p) => row.program_id===p.id || (row.service_id && svcById(row.service_id)?.program_id===p.id);
const progTx = p => liveTx().filter(t=>inProg(t,p));
const progEx = p => S.expenses.filter(e=>!e.voided&&e.status!=='rejected'&&inProg(e,p));
const dbForService = id => S.counts.find(c=>c.service_id===id);
const dayBornAllowedFor = unitId => isChurch() && feat('dayborn') && unitById(unitId)?.is_main;
function datesBetween(a,b){ const out=[]; const d=new Date(a+'T00:00:00'), end=new Date(b+'T00:00:00'); while(d<=end && out.length<62){ out.push(d.toLocaleDateString('en-CA')); d.setDate(d.getDate()+1); } return out; }
const progStatus = p => { const t=todayISO(); return t<p.starts_on?['gold','Upcoming']:t>p.ends_on?['','Ended']:['good','On now']; };

/* ===================== Data ===================== */
async function must(p){ const {data,error} = await p; if(error) throw error; return data; }
async function fetchAll(build){ // page through >1000 rows
  let out=[], from=0; const size=1000;
  for(;;){ const rows = await must(build().range(from, from+size-1)); out=out.concat(rows); if(rows.length<size) break; from+=size; }
  return out;
}
async function loadOrgs(){
  await sb.rpc('accept_invites');
  const rows = await must(sb.from('org_users').select('*, orgs(*)').eq('user_id', S.user.id));
  S.orgs = rows.filter(r=>r.orgs);
  let pick = null; try{ pick = localStorage.getItem('sikabook.org'); }catch(e){}
  const row = S.orgs.find(r=>r.org_id===pick) || S.orgs[0];
  S.org = row ? row.orgs : null; S.me = row || null;
}
async function loadAll(){
  if(!S.org) return;
  const o = S.org.id;
  const [org, units, ou, members, txs, counts, budgets, targets, payees, exps, camps, services, programs] = await Promise.all([
    must(sb.from('orgs').select('*').eq('id',o).single()),
    must(sb.from('units').select('*').eq('org_id',o).order('created_at')),
    must(sb.from('org_users').select('*').eq('org_id',o)),
    fetchAll(()=>sb.from('members').select('*').eq('org_id',o).order('full_name')),
    fetchAll(()=>sb.from('transactions').select('*').eq('org_id',o).order('txn_date',{ascending:false}).order('created_at',{ascending:false})),
    fetchAll(()=>sb.from('dayborn_counts').select('*').eq('org_id',o).order('sunday')),
    must(sb.from('budgets').select('*').eq('org_id',o).order('created_at')),
    must(sb.from('targets').select('*').eq('org_id',o).order('created_at')),
    must(sb.from('payees').select('*').eq('org_id',o).order('name')),
    fetchAll(()=>sb.from('expenses').select('*').eq('org_id',o).order('exp_date',{ascending:false}).order('created_at',{ascending:false})),
    must(sb.from('campaigns').select('*').eq('org_id',o).order('created_at')),
    fetchAll(()=>sb.from('services').select('*').eq('org_id',o).order('service_date',{ascending:false}).order('created_at',{ascending:false})),
    must(sb.from('programs').select('*').eq('org_id',o).order('starts_on',{ascending:false})),
  ]);
  Object.assign(S,{org,units,orgUsers:ou,members,txs,counts,budgets,targets,payees,expenses:exps,camps,services,programs});
  S.me = ou.find(r=>r.user_id===S.user.id) || S.me;
  const unitIds = units.map(u=>u.id), payeeIds = payees.map(p=>p.id), campIds = camps.map(c=>c.id);
  const [mu, lines, pledges, invites, logs] = await Promise.all([
    unitIds.length ? fetchAll(()=>sb.from('member_units').select('*').in('unit_id', unitIds)) : [],
    payeeIds.length ? must(sb.from('payee_lines').select('*').in('payee_id', payeeIds).order('created_at')) : [],
    campIds.length ? must(sb.from('pledges').select('*').in('campaign_id', campIds)) : [],
    isAdmin() ? must(sb.from('invites').select('*').eq('org_id',o).is('accepted_at',null).order('created_at')) : [],
    isApprover() ? must(sb.from('audit_log').select('*').eq('org_id',o).order('at',{ascending:false}).limit(300)) : [],
  ]);
  Object.assign(S,{mu,lines,pledges,invites,logs});
  if(S.view!=='all' && !unitById(S.view)) S.view='all';
}
async function refresh(msg){ try{ await loadAll(); if(msg) toast(msg); }catch(e){ toast(errText(e)); } render(); }
const errText = e => (e && (e.message||e.error_description)) ? (e.message||e.error_description).replace(/^.*?ERROR:\s*/,'') : 'Something went wrong. Check your internet and try again.';
async function act(fn, okMsg){
  if(S.busy) return; S.busy=true;
  try{ await fn(); S.sheet=null; await loadAll(); if(okMsg) toast(okMsg); }
  catch(e){ toast(errText(e)); }
  finally{ S.busy=false; render(); }
}

/* ===================== Charts ===================== */
function niceMax(m){ const p=Math.pow(10,Math.floor(Math.log10(Math.max(m,1)))); for(const f of [1,1.2,1.5,2,2.5,3,4,5,6,8,10]) if(f*p>=m) return f*p; return 10*p; }
function barChart(labels, values, aria){
  if(!values.length) return '<span class="muted">No data yet.</span>';
  const w=isDesk()?640:360, h=200, pl=40, pr=10, pt=22, pb=26, iw=w-pl-pr, ih=h-pt-pb;
  const max=niceMax(Math.max(...values,1)), n=values.length, step=iw/n, bw=Math.max(6,Math.min(34,step*.62)), r=4, y=v=>pt+ih-(v/max)*ih;
  let s=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(aria)}">`;
  [0,.5,1].forEach(f=>{ const yy=pt+ih-f*ih; s+=`<line class="cg" x1="${pl}" x2="${w-pr}" y1="${yy}" y2="${yy}"/><text class="ct" x="${pl-6}" y="${yy+4}" text-anchor="end">${short(max*f)}</text>`; });
  const every=Math.ceil(n/(isDesk()?12:6));
  values.forEach((v,i)=>{ const x=pl+i*step+(step-bw)/2, top=y(v), base=pt+ih, rr=Math.min(r,base-top);
    if(v>0) s+=`<path class="cb ${i===n-1?'last':''}" d="M${x},${base}V${top+rr}Q${x},${top} ${x+rr},${top}H${x+bw-rr}Q${x+bw},${top} ${x+bw},${top+rr}V${base}Z"/>`;
    s+=`<rect class="hit" x="${pl+i*step}" y="${pt}" width="${step}" height="${ih}" data-tip="${esc(labels[i])} · ${esc(fmt(v))}"/>`;
    if((n-1-i)%every===0) s+=`<text class="ct" x="${x+bw/2}" y="${h-8}" text-anchor="middle">${esc(labels[i])}</text>`; });
  const lx=pl+(n-1)*step+step/2; s+=`<text class="ctv" x="${Math.min(lx,w-pr-14)}" y="${y(values[n-1])-7}" text-anchor="middle">${short(values[n-1])}</text>`;
  return `<div class="chart">${s}</svg></div>`;
}
function lineChart(labels, actual, plan, aria, names){
  const w=isDesk()?640:360, h=220, pl=42, pr=14, pt=16, pb=26, iw=w-pl-pr, ih=h-pt-pb, n=labels.length;
  const max=niceMax(Math.max(1,...actual.filter(v=>v!=null),...plan)), X=i=>pl+i*(iw/(n-1)), Y=v=>pt+ih-(v/max)*ih;
  let s=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(aria)}">`;
  [0,.25,.5,.75,1].forEach(f=>{ const yy=pt+ih-f*ih; s+=`<line class="cg" x1="${pl}" x2="${w-pr}" y1="${yy}" y2="${yy}"/>${f%.5===0?`<text class="ct" x="${pl-6}" y="${yy+4}" text-anchor="end">${short(max*f)}</text>`:''}`; });
  const pts=actual.map((v,i)=>v==null?null:[X(i),Y(v)]).filter(Boolean), last=pts[pts.length-1];
  if(pts.length){ s+=`<path class="ar" d="M${pts[0][0]},${pt+ih}L${pts.map(p=>p.join(',')).join('L')}L${last[0]},${pt+ih}Z"/>`; }
  s+=`<path class="ln b" d="M${plan.map((v,i)=>X(i)+','+Y(v)).join('L')}"/>`;
  if(pts.length){ s+=`<path class="ln a" d="M${pts.map(p=>p.join(',')).join('L')}"/><circle class="dot" cx="${last[0]}" cy="${last[1]}" r="4.5"/><text class="ctv" x="${last[0]}" y="${last[1]-10}" text-anchor="middle">${short(actual[pts.length-1])}</text>`; }
  const every=isDesk()?1:2;
  labels.forEach((l,i)=>{ if(i%every===0||i===n-1) s+=`<text class="ct" x="${X(i)}" y="${h-8}" text-anchor="middle">${l}</text>`;
    s+=`<rect class="hit" x="${X(i)-iw/(n-1)/2}" y="${pt}" width="${iw/(n-1)}" height="${ih}" data-tip="${esc(`${l} · ${names[0]} ${actual[i]==null?'—':fmt(actual[i])} · ${names[1]} ${fmt(plan[i])}`)}"/>`; });
  return `<div class="legend"><span><i class="sw"></i>${names[0]}</span><span><i class="sw b"></i>${names[1]}</span></div><div class="chart">${s}</svg></div>`;
}

/* ===================== Auth & setup screens ===================== */
function authView(){
  const m=S.authMode;
  if(S.recovery) return `<div class="auth"><div class="logo"><i>₵</i><span>SikaBook</span></div>
    <div class="card"><h3>Choose a new password</h3><input type="password" id="np" placeholder="New password (8+ characters)" autocomplete="new-password"><button class="btn" data-act="setpw">Save password</button><span class="err">${esc(S.authMsg)}</span></div></div>`;
  return `<div class="auth"><div class="logo"><i>₵</i><span>SikaBook</span></div>
    <div><h1 style="font-size:26px">${m==='signup'?'Create your account':m==='reset'?'Reset your password':'Sign in'}</h1><p class="muted" style="font-size:15px;margin:.4em 0 0">Church and organization finance, on your phone and laptop.</p></div>
    <div class="card">
      <label class="f">Email<input type="email" id="ae" autocomplete="email" placeholder="you@example.com"></label>
      ${m!=='reset'?`<label class="f">Password<input type="password" id="ap" autocomplete="${m==='signup'?'new-password':'current-password'}" placeholder="${m==='signup'?'At least 8 characters':''}"></label>`:''}
      <button class="btn full" data-act="${m==='signup'?'signup':m==='reset'?'reset':'signin'}">${m==='signup'?'Create account':m==='reset'?'Send reset link':'Sign in'}</button>
      ${S.authMsg?`<span class="${/check|sent/i.test(S.authMsg)?'muted':'err'}">${esc(S.authMsg)}</span>`:''}
    </div>
    <div class="btnrow" style="justify-content:space-between">
      ${m!=='signin'?`<button class="link" data-act="authmode" data-id="signin">I already have an account</button>`:`<button class="link" data-act="authmode" data-id="signup">Create an account</button>`}
      ${m!=='reset'?`<button class="link" data-act="authmode" data-id="reset">Forgot password?</button>`:''}
    </div>
    <span class="muted">If someone invited you, create your account with the same email they used. You'll see your church or organization straight away.</span>
  </div>`;
}
const SETUP = {kind:'church', name:'MDCC Teshie No. 1', main:'Teshie No. 1 Station', subs:"Youth Fellowship\nChoir\nSunday School\nWomen's Fellowship\nMen's Fellowship", cur:'GHS', dayborn:true, pledges:true};
function setupView(){
  const ch=SETUP.kind==='church';
  return `<div class="setup">
    <div class="brand logo"><i>₵</i><span>SikaBook</span></div>
    <div><h1>Set up your finance book</h1><p class="muted" style="font-size:15px;margin:.4em 0 0">Signed in as ${esc(S.user.email)}. You can change all of this later in Settings.</p></div>
    <div class="card"><span class="stepn">Step 1 · What are you setting up?</span>
      <div class="choice">
        <button data-act="stype" data-id="church" aria-pressed="${ch}"><i>⛪</i><b>Church</b><small>Station, societies, offering, tithe, thanksgiving, Day Born, welfare and funeral dues.</small></button>
        <button data-act="stype" data-id="org" aria-pressed="${!ch}"><i>🏢</i><b>Organization</b><small>Association, NGO, school, club or business. Head office, departments, dues and donations.</small></button>
      </div></div>
    <div class="card"><span class="stepn">Step 2 · Names and currency</span>
      <label class="f">${ch?'Church name':'Organization name'}<input type="text" id="sname" value="${esc(SETUP.name)}"></label>
      <label class="f">${ch?'Main church (station) name':'Head office name'}<input type="text" id="smain" value="${esc(SETUP.main)}"></label>
      <label class="f">${ch?'Societies and groups':'Departments or branches'} <span class="muted">(one per line)</span><textarea id="ssubs">${esc(SETUP.subs)}</textarea></label>
      <label class="f">Currency<select id="scur">${CURRENCIES.map(([c,s,n])=>`<option value="${c}" ${SETUP.cur===c?'selected':''}>${s} · ${n} (${c})</option>`).join('')}</select></label></div>
    <div class="card"><span class="stepn">Step 3 · Features</span>
      ${ch?`<label class="toggle"><span>Day Born offering<small>8 day groups every Sunday, with totals and charts</small></span><input type="checkbox" id="sdb" ${SETUP.dayborn?'checked':''}></label>`:''}
      <label class="toggle"><span>Pledges & fundraising<small>Targets, pledges and who has paid</small></span><input type="checkbox" id="spl" ${SETUP.pledges?'checked':''}></label></div>
    <button class="btn full" style="padding:14px" data-act="createorg">${S.busy?'Setting up…':'Create my finance book'}</button>
    <button class="link" style="align-self:center" data-act="signout">Sign out</button>
  </div>`;
}

/* ===================== Main views ===================== */
function home(){
  const sc=scope(), t=liveTx().filter(x=>inScope(x.unit_id)), ex=S.expenses.filter(x=>inScope(x.unit_id));
  const mk=todayISO().slice(0,7), bal=balanceOf(sc);
  const inc=t.filter(x=>ym(x.txn_date)===mk).reduce((s,x)=>s+num(x.amount),0), out=ex.filter(x=>counted(x)&&ym(x.exp_date)===mk).reduce((s,x)=>s+num(x.amount),0);
  const cats={}; t.filter(x=>ym(x.txn_date)===mk).forEach(x=>cats[x.category]=(cats[x.category]||0)+num(x.amount));
  const catArr=Object.entries(cats).sort((a,b)=>b[1]-a[1]), maxC=catArr.length?catArr[0][1]:1;
  const pend=ex.filter(x=>!x.voided&&(x.status==='pending'||x.status==='approved'));
  const bl=budgetRows(), bT=bl.reduce((s,b)=>s+num(b.amount),0), bS=bl.reduce((s,b)=>s+b.spent,0), over=bl.filter(b=>b.spent>num(b.amount)&&num(b.amount)>0);
  const owing=owingMembers();
  const recent=[...t.slice(0,12).map(x=>({kind:'in',d:x.txn_date,u:x.unit_id,desc:x.member_id?`${x.category} — ${memberName(x.member_id)}`:(x.note&&x.category==='Day Born'?x.note:x.category),amt:num(x.amount),id:x.id})),
                ...ex.slice(0,12).map(x=>({kind:'out',d:x.exp_date,u:x.unit_id,desc:`${x.paid_to} — ${x.purpose}`,amt:num(x.amount),id:x.id,voided:x.voided}))]
                .sort((a,b)=>b.d.localeCompare(a.d)).slice(0,isDesk()?8:6);
  const unitRows = S.view==='all'&&S.units.length>1 ? S.units.map(u=>`<button class="item" data-act="view" data-id="${u.id}"><span class="av">${esc(u.name[0])}</span><span class="t"><b>${esc(u.name)}</b><small>${esc(u.level)}</small></span><span class="amt num">${fmt(balanceOf(descendants(u.id)))}</span><span class="chev">›</span></button>`).join('') : '';
  const sundays = canDayBorn() ? dbRows().slice(-12) : [];
  const empty = !S.txs.length && !S.expenses.length;
  const lastSvc = S.services.find(s=>inScope(s.unit_id));
  return `<div class="grid2"><div class="col">
    <section class="hero" aria-label="Summary">
      <div><div class="lab">${esc(scopeLabel())} · Balance</div><div class="big num">${fmt(bal)}</div></div>
      <div class="row"><div class="pill"><span>Money in · ${MONTHS[MONTH]}</span><b class="num">${fmt(inc)}</b></div><div class="pill"><span>Money out · ${MONTHS[MONTH]}</span><b class="num">${fmt(out)}</b></div></div>
    </section>
    ${canWrite()?`<div class="quick">
      <button data-act="sheet" data-t="income"><i>＋</i>Record income</button>
      <button data-act="sheet" data-t="expnew"><i>−</i>Record expense</button>
      <button data-act="sheet" data-t="newservice"><i>▦</i>New service</button>
    </div>`:''}
    ${lastSvc?`<button class="card" style="text-align:left;cursor:pointer" data-act="opensvc" data-id="${lastSvc.id}"><div class="cardhead"><h3>Latest service · ${esc(lastSvc.title||lastSvc.kind)}</h3><span class="muted">${dLong(lastSvc.service_date)}</span></div>
      <div class="mini"><div><span>Income</span><b>${fmt(sumAmt(svcTx(lastSvc.id)))}</b></div><div><span>Expenses</span><b>${fmt(sumAmt(svcEx(lastSvc.id).filter(counted)))}</b></div></div><span class="link">Open service sheet ›</span></button>`:''}
    ${empty?`<div class="card"><h3>Welcome to SikaBook</h3><span class="muted">Start by setting each unit's starting balance in Structure, adding members, then recording this Sunday's income.</span><div class="btnrow"><button class="btn small" data-act="tab" data-id="structure">Set starting balances</button><button class="btn small ghost" data-act="tab" data-id="members">Add members</button></div></div>`:''}
    ${pend.length?`<button class="alert" data-act="tab" data-id="spend"><span>⏳</span><span><b>${pend.length} expense${pend.length>1?'s':''}</b> waiting for approval or for the recipient to confirm.</span></button>`:''}
    ${over.length?`<button class="alert" data-act="tab" data-id="budget" style="background:var(--bad-soft)"><span>⚠</span><span><b style="color:var(--bad)">Over budget:</b> ${over.map(b=>esc(b.name)).join(', ')}</span></button>`:''}
    ${sundays.length?`<div class="card"><div class="cardhead"><h3>Day Born · each Sunday</h3><button class="link" data-act="tab" data-id="dayborn">Open Day Born ›</button></div>${barChart(sundays.map(r=>dShort(r.sunday)),sundays.map(r=>r.total),'Day Born total each Sunday')}</div>`:''}
    <div class="card"><h3>Where the money came from · ${MONTHS[MONTH]}</h3><div class="bars">${catArr.map(([c,v])=>`<div class="bar"><span>${esc(c)}</span><b class="num">${fmt(v)}</b><div class="track"><div class="fill ${c==='Day Born'?'gold':''}" style="width:${(v/maxC*100).toFixed(1)}%"></div></div></div>`).join('')||'<span class="muted">No income recorded this month yet.</span>'}</div></div>
  </div><div class="col">
    ${unitRows?`<div class="card"><div class="cardhead"><h3>Units</h3><span class="muted">Tap to open</span></div><div class="list">${unitRows}</div></div>`:''}
    ${bl.length?`<div class="card"><div class="cardhead"><h3>${YEAR} budget</h3><button class="link" data-act="tab" data-id="budget">Open budget ›</button></div>
      <div class="bar"><span>${fmt(bS)} spent of ${fmt(bT)}</span><b class="num">${bT?Math.round(bS/bT*100):0}%</b><div class="track"><div class="fill" style="width:${bT?Math.min(100,bS/bT*100):0}%"></div><div class="pace" style="left:${(MONTH+1)/12*100}%"></div></div></div>
      <span class="muted">The dark mark shows where spending should be by the end of ${MONTHS[MONTH]}.</span></div>`:''}
    ${owing.length?`<button class="alert" data-act="tab" data-id="members" style="background:var(--surface-2)"><span>📋</span><span><b style="color:var(--ink)">${owing.length} member${owing.length>1?'s':''}</b> ha${owing.length>1?'ve':'s'} not paid ${inScope(mainUnit()?.id)?esc(C().tithe.toLowerCase()):'dues'} for ${MONTHS[MONTH]}.</span></button>`:''}
    <div class="card"><h3>Latest entries</h3><div class="list">
      ${recent.map(x=>x.kind==='out'
        ?`<button class="item" data-act="sheet" data-t="expense" data-id="${x.id}"><span class="t"><b>${esc(x.desc)}</b><small>${esc(uName(x.u))} · ${dShort(x.d)} · expense${x.voided?' · voided':''}</small></span><span class="amt num out">−${short(x.amt)}</span><span class="chev">›</span></button>`
        :`<button class="item" data-act="sheet" data-t="txn" data-id="${x.id}"><span class="t"><b>${esc(x.desc)}</b><small>${esc(uName(x.u))} · ${dShort(x.d)}</small></span><span class="amt num in">+${short(x.amt)}</span><span class="chev">›</span></button>`).join('')||'<span class="muted">Nothing recorded yet.</span>'}</div></div>
  </div></div>`;
}

/* ---- Members ---- */
const membersInScope = () => S.members.filter(m=>S.mu.some(x=>x.member_id===m.id&&inScope(x.unit_id)));
const unitsOfMember = id => S.mu.filter(x=>x.member_id===id).map(x=>x.unit_id);
function owingMembers(){
  const mk=todayISO().slice(0,7), main=mainUnit()?.id, st=main&&inScope(main);
  const cat = st ? C().tithe : 'Monthly dues';
  return membersInScope().filter(m=>m.active && !liveTx().some(t=>t.member_id===m.id&&t.category===cat&&ym(t.txn_date)===mk));
}
function membersView(){
  if(S.member){ const m=S.members.find(x=>x.id===S.member); if(m) return memberProfile(m); S.member=null; }
  const vis=membersInScope(), owing=owingMembers(), st=inScope(mainUnit()?.id);
  const groups=S.units.filter(u=>inScope(u.id)).map(u=>`<span class="chip">${esc(u.name)} · ${S.mu.filter(x=>x.unit_id===u.id).length}</span>`).join('');
  return `<div class="pagehead"><h2>Members</h2><span class="muted">${vis.length} members in ${esc(scopeLabel())}. Search for a name, or show the full list.</span></div>
  <div class="stack"><div class="grid2"><div class="col">
    <input type="text" id="msearch" placeholder="Search a name" value="${esc(S.q)}" autocomplete="off">
    <div class="chips">${groups}</div>
    <div class="card" id="mlist">${memberList(vis)}</div>
    ${canWrite()?`<button class="btn ghost full" data-act="sheet" data-t="member">＋ Add a member</button>`:''}
  </div><div class="col">
    <div class="card"><div class="cardhead"><h3>Not paid for ${MONTHS[MONTH]}</h3><span class="chip ${owing.length?'warn':'good'}">${owing.length} · ${st?esc(C().tithe.toLowerCase()):'dues'}</span></div>
      ${S.showOwing?`<div class="list">${owing.map(m=>`<button class="item" data-act="member" data-id="${m.id}"><span class="t"><b>${esc(m.full_name)}</b><small>${esc(m.phone||'No phone')}</small></span><span class="chev">›</span></button>`).join('')||'<span class="muted">Everyone has paid.</span>'}</div>`
        :`<span class="muted">Names stay hidden until you open the list.</span><button class="btn small ghost" style="align-self:flex-start" data-act="owing">Show names</button>`}</div>
  </div></div></div>`;
}
function memberList(vis){
  const q=S.q.trim().toLowerCase();
  if(!vis.length) return `<div class="empty"><b>No members yet</b><span class="muted">Add your members so you can record tithe, dues and pledges against their names.</span></div>`;
  if(!q&&!S.showAll) return `<div class="lock"><i>🔒</i><b>The member list stays hidden until you ask for it</b><span class="muted">so it isn't on screen when you open the app.</span><button class="btn small" data-act="showall">Show all ${vis.length} members</button></div>`;
  const list=vis.filter(m=>m.full_name.toLowerCase().includes(q)||(m.phone||'').includes(q));
  if(!list.length) return `<span class="muted">No member called “${esc(S.q)}”.</span>`;
  return `<div class="list">${list.map(m=>`<button class="item" data-act="member" data-id="${m.id}"><span class="av">${esc(m.full_name.split(' ').map(w=>w[0]).join('').slice(0,2))}</span><span class="t"><b>${esc(m.full_name)}</b><small>${S.org.kind==='church'&&dayLabel(m)?esc(dayLabel(m))+' · ':''}${unitsOfMember(m.id).filter(inScope).map(uName).map(esc).join(', ')}</small></span><span class="chev">›</span></button>`).join('')}</div>`;
}
function memberProfile(m){
  const st=inScope(mainUnit()?.id), ch=S.org.kind==='church', mt=liveTx().filter(t=>t.member_id===m.id&&inScope(t.unit_id));
  const yearTx=mt.filter(t=>t.txn_date.startsWith(String(YEAR)));
  const byCat=c=>yearTx.filter(t=>t.category===c).reduce((s,t)=>s+num(t.amount),0);
  const monthly=c=>MONTHS.map((_,i)=>i>MONTH?null:yearTx.filter(t=>t.category===c&&+t.txn_date.slice(5,7)===i+1).reduce((s,t)=>s+num(t.amount),0));
  const mo=arr=>`<div class="months">${arr.map((v,i)=>`<div class="mo ${v===null?'future':v?'paid':'miss'}">${MONTHS[i]}<b>${v===null?'—':v?short(v):'Owing'}</b></div>`).join('')}</div>`;
  const tithe=monthly(C().tithe), owing=tithe.filter(v=>v===0).length;
  const pl=S.pledges.filter(p=>p.member_id===m.id).map(p=>({...p,c:S.camps.find(c=>c.id===p.campaign_id)})).filter(p=>p.c&&inScope(p.c.unit_id));
  const cats=[...new Set(yearTx.map(t=>t.category))];
  return `<button class="back" data-act="member" data-id="">‹ Members</button>
  <div class="pagehead" style="margin-top:8px"><h2 style="display:block">${esc(m.full_name)}</h2><div class="chips">${ch&&dayLabel(m)?`<span class="chip gold">${esc(dayLabel(m))}${m.day_born&&m.day_born!=='Unknown'?' · '+m.day_born+'-born':''}</span>`:''}${unitsOfMember(m.id).filter(inScope).map(u=>`<span class="chip">${esc(uName(u))}</span>`).join('')}${m.active?'':'<span class="chip bad">Inactive</span>'}</div><span class="muted num">${esc(m.phone||'')}</span></div>
  <div class="stack"><div class="grid2"><div class="col">
    <div class="card"><h3>${YEAR} so far</h3><div class="mini">${cats.length?cats.map(c=>`<div><span>${esc(c)}</span><b>${fmt(byCat(c))}</b></div>`).join(''):'<span class="muted">No payments recorded this year.</span>'}</div></div>
    ${pl.length?`<div class="card"><h3>Pledges</h3><div class="bars">${pl.map(p=>{const paid=liveTx().filter(t=>t.campaign_id===p.campaign_id&&t.member_id===m.id).reduce((s,t)=>s+num(t.amount),0); return `<div class="bar"><span>${esc(p.c.name)}</span><b class="num">${fmt(paid)} of ${fmt(p.amount)}</b><div class="track"><div class="fill" style="width:${Math.min(100,paid/num(p.amount)*100)}%"></div></div></div>`}).join('')}</div></div>`:''}
    <div class="btnrow">${canWrite()?`<button class="btn" data-act="sheet" data-t="income" data-member="${m.id}">＋ Record a payment</button><button class="btn ghost" data-act="sheet" data-t="editmember" data-id="${m.id}">Edit details</button>`:''}<button class="btn ghost" data-act="sharestatement" data-id="${m.id}">Share statement</button></div>
    <div class="card"><h3>Payment history</h3><div class="list">${mt.slice(0,30).map(t=>`<button class="item" data-act="sheet" data-t="txn" data-id="${t.id}"><span class="t"><b>${esc(t.category)}</b><small>${dLong(t.txn_date)} · ${esc(uName(t.unit_id))} · receipt #${t.receipt_no}</small></span><span class="amt num">${fmt(t.amount)}</span></button>`).join('')||'<span class="muted">No payments yet.</span>'}</div></div>
  </div><div class="col">
    ${st?`<div class="card"><div class="cardhead"><h3>Monthly ${esc(C().tithe.toLowerCase())} · ${YEAR}</h3>${owing?`<span class="chip bad">${owing} month${owing>1?'s':''} not paid</span>`:`<span class="chip good">Up to date</span>`}</div>${mo(tithe)}</div>`
        :`<div class="note">${esc(C().tithe)} and other main church records are hidden for your role.</div>`}
    <div class="card"><h3>Monthly dues · ${YEAR}</h3>${mo(monthly('Monthly dues'))}</div>
  </div></div></div>`;
}

/* ---- Day Born ---- */
function dbRows(){ const main=mainUnit(); if(!main) return []; return S.counts.filter(c=>c.unit_id===main.id).map(c=>({...c,amts:c.amounts.map(num),total:c.amounts.reduce((s,v)=>s+num(v),0)})).sort((a,b)=>a.sunday.localeCompare(b.sunday)); }
function lastSunday(){ const d=new Date(); d.setDate(d.getDate()-d.getDay()); return d.toLocaleDateString('en-CA'); } // today if Sunday
function dayBornView(){
  if(!canDayBorn()) return `<div class="card lock"><i>🔒</i><b>Day Born belongs to the main church</b><span class="muted">It isn't available for your role or this unit.</span></div>`;
  if(S.group!==null) return dayGroupView(S.group);
  const rows=dbRows(), yr=rows.filter(r=>r.sunday.startsWith(String(YEAR))), n=yr.length, year=yr.reduce((s,r)=>s+r.total,0);
  const allTime=rows.reduce((s,r)=>s+r.total,0), dbEx=S.expenses.filter(e=>e.fund==='Day Born fund'&&!e.voided), spent=dbEx.filter(counted).reduce((s,e)=>s+num(e.amount),0);
  const show=rows.slice(isDesk()?-16:-12);
  const gTot=i=>yr.reduce((s,r)=>s+r.amts[i],0), ranked=DAYS.map((g,i)=>({g,i,t:gTot(i)})).sort((a,b)=>b.t-a.t);
  return `<div class="pagehead row"><div><h2>Day Born</h2><span class="muted">${esc(mainUnit().name)} · ${n} Sunday${n===1?'':'s'} recorded in ${YEAR}</span></div>${canWrite()?`<button class="btn" data-act="sheet" data-t="dayentry">＋ Record a Sunday</button>`:''}</div>
  <div class="stack">
    <div class="tiles">
      <div class="tile"><span>Total in ${YEAR}</span><b>${fmt(year)}</b></div>
      <div class="tile"><span>Last Sunday${rows.length?' · '+dShort(rows[rows.length-1].sunday):''}</span><b>${fmt(rows.length?rows[rows.length-1].total:0)}</b></div>
      <div class="tile"><span>Average per Sunday</span><b>${fmt(n?year/n:0)}</b></div>
      <div class="tile"><span>Day Born fund balance</span><b>${fmt(allTime-spent)}</b></div>
    </div>
    ${rows.length?`<div class="grid2"><div class="col">
      <div class="card"><div class="cardhead"><h3>Total each Sunday</h3><span class="muted">Tap or hover a bar</span></div>${barChart(show.map(r=>dShort(r.sunday)),show.map(r=>r.total),'Day Born total each Sunday')}</div>
    </div><div class="col">
      <div class="card"><div class="cardhead"><h3>Groups ranked · ${YEAR}</h3></div><div class="bars">
        ${ranked.map(r=>`<div class="bar"><span><button class="link" style="color:var(--ink)" data-act="group" data-i="${r.i}">${r.g.d==='Unknown'?'No day name':r.g.d}${r.g.f?` · ${r.g.m}/${r.g.f}`:''}</button></span><b class="num">${fmt(r.t)}</b><div class="track"><div class="fill gold" style="width:${ranked[0].t?(r.t/ranked[0].t*100).toFixed(1):0}%"></div></div></div>`).join('')}</div></div>
    </div></div>
    <div class="card"><div class="cardhead"><h3>Every group, every Sunday</h3><span class="muted">Tap a group for details${isDesk()?'':' · scroll sideways'}</span></div>
      <div class="tbl"><table><thead><tr><th>Group</th>${show.map(r=>`<th>${dShort(r.sunday)}</th>`).join('')}<th class="sum">Total</th></tr></thead><tbody>
        ${DAYS.map((g,gi)=>`<tr><td><button data-act="group" data-i="${gi}">${g.d==='Unknown'?'No day name':g.d}<small>${g.f?`${g.m} · ${g.f}`:'Day not known'}</small></button></td>${show.map(r=>`<td>${r.amts[gi].toLocaleString('en-US')}</td>`).join('')}<td class="sum"><b>${show.reduce((s,r)=>s+r.amts[gi],0).toLocaleString('en-US')}</b></td></tr>`).join('')}
        <tr class="total"><td>All groups</td>${show.map(r=>`<td>${r.total.toLocaleString('en-US')}</td>`).join('')}<td class="sum">${show.reduce((s,r)=>s+r.total,0).toLocaleString('en-US')}</td></tr>
      </tbody></table></div><span class="muted">Amounts in ${curSym()}. Showing the last ${show.length} Sundays.</span></div>`
    :`<div class="card"><div class="empty"><b>No Sundays recorded yet</b><span class="muted">After the service, tap “Record a Sunday” and enter the amount for each of the 8 groups.</span></div></div>`}
    <div class="card"><div class="cardhead"><h3>Expenses paid from Day Born</h3><span class="muted">${fmt(spent)} spent</span></div>
      <div class="list">${dbEx.map(expRow).join('')||'<span class="muted">None yet.</span>'}</div>
      ${canWrite()?`<button class="btn ghost" style="align-self:flex-start" data-act="sheet" data-t="expnew" data-fund="Day Born fund">＋ Record a Day Born expense</button>`:''}</div>
  </div>`;
}
function dayGroupView(gi){
  const g=DAYS[gi], rows=dbRows(), vals=rows.map(r=>r.amts[gi]), n=vals.length, tot=vals.reduce((a,b)=>a+b,0);
  const best=n?Math.max(...vals):0, bi=vals.indexOf(best), diff=n>1?vals[n-1]-vals[n-2]:0;
  const mem=membersInScope().filter(m=>m.day_born===g.d);
  return `<button class="back" data-act="group" data-i="-1">‹ Day Born</button>
  <div class="pagehead" style="margin-top:8px"><h2 style="display:block">${g.d==='Unknown'?'No day name':g.d}${g.f?` · ${g.m} & ${g.f}`:''}</h2><span class="muted">${g.f?`${g.m} (men) and ${g.f} (women), born on ${g.d}`:'Members who do not know their day of birth'}</span></div>
  <div class="stack">
    <div class="tiles">
      <div class="tile"><span>Total (all Sundays)</span><b>${fmt(tot)}</b></div>
      <div class="tile"><span>Average per Sunday</span><b>${fmt(n?tot/n:0)}</b></div>
      <div class="tile"><span>Last Sunday</span><b>${fmt(n?vals[n-1]:0)}</b>${n>1?`<span class="chip ${diff>=0?'good':'bad'}" style="align-self:flex-start">${diff>=0?'▲':'▼'} ${fmt(Math.abs(diff))} vs week before</span>`:''}</div>
      <div class="tile"><span>Best Sunday</span><b>${fmt(best)}</b><span>${n?dLong(rows[bi].sunday):''}</span></div>
    </div>
    <div class="grid2"><div class="col">
      <div class="card"><h3>Each Sunday</h3>${barChart(rows.slice(-16).map(r=>dShort(r.sunday)),vals.slice(-16),'Group total each Sunday')}</div>
      ${mem.length?`<div class="card"><h3>Members in this group</h3><div class="list">${mem.map(m=>`<button class="item" data-act="gomember" data-id="${m.id}"><span class="t"><b>${esc(m.full_name)}</b></span><span class="chev">›</span></button>`).join('')}</div></div>`:''}
    </div><div class="col">
      <div class="card"><h3>Sunday by Sunday</h3><div class="list">${rows.map((r,i)=>({r,v:vals[i]})).reverse().map(({r,v})=>`<div class="item"><span class="t"><b>${dLong(r.sunday)}</b><small>${r.total?((v/r.total)*100).toFixed(1):0}% of that Sunday's total</small></span><span class="amt num">${fmt(v)}</span></div>`).join('')||'<span class="muted">No Sundays yet.</span>'}</div></div>
    </div></div>
  </div>`;
}

/* ---- Expenses ---- */
const ST={pending:['warn','Waiting for approval'],approved:['gold','Waiting for recipient'],confirmed:['good','Recipient confirmed'],rejected:['bad','Rejected']};
const expRow=x=>`<button class="item" data-act="sheet" data-t="expense" data-id="${x.id}"><span class="t"><b>${esc(x.paid_to)} — ${esc(x.purpose)}</b><small>${dShort(x.exp_date)} · ${esc(uName(x.unit_id))} · ${esc(x.fund)}${x.service_id&&svcById(x.service_id)?' · '+esc(svcById(x.service_id).title||svcById(x.service_id).kind):''}${x.program_id&&progById(x.program_id)?' · '+esc(progById(x.program_id).name):''}</small></span><span class="right"><span class="amt num">${fmt(x.amount)}</span>${x.voided?'<span class="chip bad">Voided</span>':`<span class="chip ${ST[x.status][0]}">${ST[x.status][1]}</span>`}</span><span class="chev">›</span></button>`;
function spendView(){
  if(S.payee){ const p=S.payees.find(x=>x.id===S.payee); if(p) return payeeView(p); S.payee=null; }
  const ex=S.expenses.filter(x=>inScope(x.unit_id)), mk=todayISO().slice(0,7);
  const mo=ex.filter(x=>counted(x)&&ym(x.exp_date)===mk).reduce((s,x)=>s+num(x.amount),0), wait=ex.filter(x=>!x.voided&&(x.status==='pending'||x.status==='approved')).length;
  const tabs=`<div class="seg" role="group" aria-label="Show"><button data-act="skind" data-id="all" aria-pressed="${S.spendKind==='all'}">All expenses</button><button data-act="skind" data-id="person" aria-pressed="${S.spendKind==='person'}">People</button><button data-act="skind" data-id="project" aria-pressed="${S.spendKind==='project'}">Projects</button></div>`;
  let body;
  if(S.spendKind==='all') body=`<div class="card"><div class="cardhead"><h3>All expenses</h3><span class="muted">Tap any expense to see its details</span></div><div class="list">${ex.map(expRow).join('')||'<span class="muted">No expenses yet.</span>'}</div></div>`;
  else { const list=S.payees.filter(p=>inScope(p.unit_id)&&p.kind===S.spendKind);
    body=`<div class="card"><div class="list">${list.map(p=>{const pe=S.expenses.filter(x=>x.payee_id===p.id&&!x.voided), tot=pe.filter(counted).filter(x=>x.exp_date.startsWith(String(YEAR))).reduce((s,x)=>s+num(x.amount),0), w=pe.filter(x=>x.status==='pending'||x.status==='approved').length;
      return `<button class="item" data-act="payee" data-id="${p.id}"><span class="av">${p.kind==='person'?'👤':'🏗'}</span><span class="t"><b>${esc(p.name)}</b><small>${esc(uName(p.unit_id))}${p.note?' · '+esc(p.note):''}</small></span><span class="right"><span class="amt num">${fmt(tot)}</span>${w?`<span class="chip warn">${w} waiting</span>`:`<span class="chip good">All settled</span>`}</span><span class="chev">›</span></button>`}).join('')||`<div class="empty"><b>No ${S.spendKind==='person'?'people':'projects'} yet</b><span class="muted">${S.spendKind==='person'?'Add someone you support regularly, such as the minister, then add their support lines (weekly support, ⅓ of tithe, gas, electricity…).':'Add a project such as a building or instrument project, then record its costs.'}</span></div>`}</div></div>
      ${canWrite()?`<button class="btn ghost full" data-act="sheet" data-t="payee">＋ Add a ${S.spendKind==='person'?'person':'project'}</button>`:''}`; }
  return `<div class="pagehead row"><div><h2>Expenses</h2><span class="muted">${esc(scopeLabel())} · ${fmt(mo)} spent in ${MONTHS[MONTH]} · ${wait} waiting</span></div>${canWrite()?`<button class="btn" data-act="sheet" data-t="expnew">＋ Record expense</button>`:''}</div>
  <div class="stack" style="max-width:880px">${tabs}${body}</div>`;
}
function payeeView(p){
  const pe=S.expenses.filter(x=>x.payee_id===p.id), lines=S.lines.filter(l=>l.payee_id===p.id), tot=pe.filter(counted).filter(x=>x.exp_date.startsWith(String(YEAR))).reduce((s,x)=>s+num(x.amount),0);
  const bName=id=>S.budgets.find(b=>b.id===id)?.name;
  return `<button class="back" data-act="payee" data-id="">‹ Expenses</button>
  <div class="pagehead" style="margin-top:8px"><h2 style="display:block">${esc(p.name)}</h2><span class="muted">${esc(uName(p.unit_id))}${p.note?' · '+esc(p.note):''} · ${fmt(tot)} given in ${YEAR}</span></div>
  <div class="stack"><div class="grid2"><div class="col">
    <div class="card"><div class="cardhead"><h3>${p.kind==='person'?'Support lines':'Cost lines'}</h3>${canWrite()?`<button class="link" data-act="sheet" data-t="line" data-id="${p.id}">＋ Add a line</button>`:''}</div><div>
      ${lines.map(l=>`<div class="line"><div><b style="font-weight:500">${esc(l.name)}</b><div class="muted">${esc(l.frequency||'')} · ${fmt(l.amount)}${bName(l.budget_id)?` · budget “${esc(bName(l.budget_id))}”`:''}</div></div>${canWrite()?`<button class="btn small" data-act="sheet" data-t="pay" data-id="${l.id}">Pay</button>`:''}</div>`).join('')||`<span class="muted">No lines yet. ${p.kind==='person'?'Add weekly support, ⅓ of tithe, charcoal, gas, electricity and so on.':'Add costs such as cement, labour or roofing.'}</span>`}</div></div>
    <div class="note">After a payment is approved, send the person a confirmation link by WhatsApp or SMS. When they tap “Yes, I received it”, the payment is marked as confirmed.</div>
  </div><div class="col">
    <div class="card"><div class="cardhead"><h3>Payments</h3><span class="muted">Tap for details</span></div><div class="list">${pe.map(expRow).join('')||'<span class="muted">No payments yet.</span>'}</div></div>
  </div></div></div>`;
}

/* ---- Budget ---- */
function budgetRows(){ return S.budgets.filter(b=>b.year===YEAR&&inScope(b.unit_id)).map(b=>({...b,spent:S.expenses.filter(e=>e.budget_id===b.id&&counted(e)).reduce((s,e)=>s+num(e.amount),0)})); }
function budgetView(){
  const bl=budgetRows(), bT=bl.reduce((s,b)=>s+num(b.amount),0), bS=bl.reduce((s,b)=>s+b.spent,0);
  const pace=(MONTH+1)/12, expected=bT*pace, diff=expected-bS, projected=pace?bS/pace:0;
  const ids=new Set(bl.map(b=>b.id)), monthly=MONTHS.map((_,i)=>S.expenses.filter(e=>ids.has(e.budget_id)&&counted(e)&&e.exp_date.startsWith(String(YEAR))&&+e.exp_date.slice(5,7)===i+1).reduce((s,e)=>s+num(e.amount),0));
  let c=0; const cum=monthly.map((v,i)=>i<=MONTH?(c+=v):null), plan=MONTHS.map((_,i)=>bT*(i+1)/12);
  const tg=S.targets.filter(t=>t.year===YEAR&&inScope(t.unit_id)).map(t=>({...t,got:liveTx().filter(x=>x.unit_id===t.unit_id&&x.category===t.category&&x.txn_date.startsWith(String(YEAR))).reduce((s,x)=>s+num(x.amount),0)}));
  const multi=S.view==='all'&&S.units.length>1;
  return `<div class="pagehead"><h2>Budget ${YEAR}</h2><span class="muted">${esc(scopeLabel())}. Approved expenses come off their budget line automatically.</span></div>
  <div class="stack">
    <div class="tiles">
      <div class="tile"><span>Budgeted for ${YEAR}</span><b>${fmt(bT)}</b></div>
      <div class="tile"><span>Spent so far</span><b>${fmt(bS)}</b><span>${bT?Math.round(bS/bT*100):0}% used · ${Math.round(pace*100)}% of the year gone</span></div>
      <div class="tile"><span>Remaining</span><b>${fmt(bT-bS)}</b></div>
      <div class="tile"><span>Compared with plan</span><b style="color:${diff>=0?'var(--good)':'var(--bad)'}">${diff>=0?'Under':'Over'} by ${fmt(Math.abs(diff))}</b><span>At this rate: ${fmt(projected)} by Dec</span></div>
    </div>
    <div class="grid2"><div class="col">
      ${bl.length?`<div class="card"><div class="cardhead"><h3>Spending through the year</h3><span class="muted">Tap a month</span></div>${lineChart(MONTHS,cum,plan,'Spending compared with the budget plan',['Spent so far','Budget plan'])}<span class="muted">When the solid line is below the dashed line, you are spending less than planned.</span></div>`:''}
      <div class="card"><div class="cardhead"><h3>Income targets · ${YEAR}</h3></div><div class="bars">
        ${tg.map(t=>{const p=t.got/num(t.amount)*100; return `<div class="bar"><span><b style="font-weight:500">${esc(t.category)}</b>${multi?` <span class="muted">· ${esc(uName(t.unit_id))}</span>`:''}</span><span class="right"><b class="num">${Math.round(p)}%</b><span class="muted num">${fmt(t.got)} of ${fmt(t.amount)}</span></span><div class="track"><div class="fill ${p>=pace*100?'':'gold'}" style="width:${Math.min(100,p)}%"></div><div class="pace" style="left:${pace*100}%"></div></div></div>`}).join('')||'<span class="muted">No targets yet. Example: Tithe target for the year.</span>'}</div>
        ${tg.length?'<span class="muted">Green: on track. Gold: behind where it should be by now (the dark mark).</span>':''}
        ${canWrite()?`<div class="row2"><select id="tcat">${C().income.concat(S.org.kind==='church'?['Day Born']:[]).map(c=>`<option>${esc(c)}</option>`).join('')}</select><input type="number" id="tamt" placeholder="Target (${curSym()})" inputmode="decimal"></div>
        ${unitPicker('tunit')}<button class="btn small" style="align-self:flex-start" data-act="addtarget">Add target</button>`:''}</div>
    </div><div class="col">
      <div class="card"><h3>Budget lines</h3><div class="bars">
        ${bl.map(b=>{const amt=num(b.amount), p=amt?b.spent/amt*100:0, cls=p>100?'bad':p>=pace*100+5?'warn':'', left=amt-b.spent;
          return `<div class="bar"><span><b style="font-weight:500">${esc(b.name)}</b>${multi?`<br><span class="muted">${esc(uName(b.unit_id))}</span>`:''}</span>
          <span class="right"><b class="num">${Math.round(p)}%</b>${p>100?`<span class="chip bad">⚠ Over by ${fmt(-left)}</span>`:cls==='warn'?`<span class="chip warn">Ahead of plan · ${fmt(left)} left</span>`:`<span class="muted num">${fmt(left)} left</span>`}</span>
          <div class="track"><div class="fill ${cls}" style="width:${Math.min(100,p)}%"></div><div class="pace" style="left:${pace*100}%"></div></div>
          <span class="muted num" style="grid-column:1/-1;display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap">${fmt(b.spent)} of ${fmt(amt)}
            ${canWrite()?(S.editB===b.id?`<span style="display:flex;gap:6px"><input type="number" id="bedit" value="${amt}" style="width:120px;padding:5px 8px"><button class="btn small" data-act="bsave" data-id="${b.id}">Save</button></span>`:`<button class="link" data-act="bedit" data-id="${b.id}">Change budget</button>`):''}</span></div>`}).join('')||'<div class="empty"><b>No budget lines yet</b><span class="muted">Add a line for each area you spend on, e.g. Minister support, Utilities, Building project, Welfare.</span></div>'}
      </div>${bl.length?'<span class="muted">The dark mark on each bar shows where spending should be by now.</span>':''}</div>
      ${canWrite()?`<div class="card"><h3>Add a budget line</h3><div class="row2"><input type="text" id="bname" placeholder="e.g. Utilities"><input type="number" id="bamt" placeholder="Amount (${curSym()})" inputmode="decimal"></div>${unitPicker('bunit')}<button class="btn" style="align-self:flex-start" data-act="badd">Add line</button></div>`:''}
    </div></div>
  </div>`;
}
function accessLabel(x){ if(!x.unit_id) return 'whole '+(isChurch()?'church':'organization'); const u=uName(x.unit_id), kids=childrenOf(x.unit_id).length; return x.include_children&&kids? `${u} + the ${kids} group${kids>1?'s':''} under it` : `${u} only`; }
function accessFields(x){ const unit=x?(x.unit_id||''):'', role=x?.role||'treasurer', kids=!!x?.include_children;
  return `<label class="f">What can they see?<select id="ivu"><option value="" ${unit===''?'selected':''}>Everything (whole ${isChurch()?'church':'organization'})</option>${S.units.map(u=>`<option value="${u.id}" ${unit===u.id?'selected':''}>${esc(u.name)} only</option>`).join('')}</select></label>
    <label class="toggle"><span>Also see the groups under that unit<small>For example a Station login that should also see every society. Leave it off so they see only that one unit.</small></span><input type="checkbox" id="ivk" ${kids?'checked':''}></label>
    <label class="f">What can they do?<select id="ivr">
      <option value="treasurer" ${role==='treasurer'?'selected':''}>Record income & expenses</option>
      <option value="finsec" ${role==='finsec'?'selected':''}>Record and approve expenses (${esc(ROLE_LABEL('finsec'))})</option>
      <option value="viewer" ${role==='viewer'?'selected':''}>Only look (viewer)</option>
      <option value="admin" ${role==='admin'?'selected':''}>Super admin: everything, including settings and people</option></select></label>
    <div class="note">Example: the Choir Treasurer gets “Choir only” and “Record income & expenses”. They will not see the Station or any other society.</div>`; }
function readAccess(){ const r=val('ivr'), u=val('ivu')||null, k=chk('ivk');
  if(r==='admin'&&u){ toast('A Super admin must see everything. Choose “Everything”, or pick another role.'); return null; }
  return {role:r, unit_id:u, include_children:u?k:false}; }
function inviteMessage(v){ return `Hello ${v.display_name||''},\nYou now have a SikaBook account for ${S.org.name} (${accessLabel(v)}).\n1. Open ${appLink()}\n2. Tap “Create an account” and use this email: ${v.email}\n3. Confirm your email, then sign in.\nOn your phone, choose “Add to Home Screen” so it opens like an app.`; }
function ctxLine(sv,pr){ if(sv) return `<div class="note">For <b>${esc(svcName(sv))}</b>${sv.program_id?' · '+esc(progById(sv.program_id)?.name||''):''}</div>`; if(pr) return `<div class="note">For program <b>${esc(pr.name)}</b></div>`; return ''; }
function progSelect(id, preset){ const ps=S.programs.filter(p=>inScope(p.unit_id)); if(!ps.length) return `<input type="hidden" id="${id}" value="">`;
  return `<label class="f">Program / event <span class="muted">(optional)</span><select id="${id}"><option value="">— None —</option>${ps.map(p=>`<option value="${p.id}" ${p.id===preset?'selected':''}>${esc(p.name)} (${dShort(p.starts_on)}–${dShort(p.ends_on)})</option>`).join('')}</select></label>`; }
function unitPicker(id, selected){
  const us=writableUnits(); if(us.length<=1) return `<input type="hidden" id="${id}" value="${us[0]?.id||''}">`;
  const def = selected || (S.view!=='all'?S.view:mainUnit()?.id);
  return `<label class="f">Unit<select id="${id}">${us.map(u=>`<option value="${u.id}" ${u.id===def?'selected':''}>${esc(u.name)}</option>`).join('')}</select></label>`;
}

/* ---- Fundraising ---- */
function campStats(c){
  const pl=S.pledges.filter(p=>p.campaign_id===c.id), tx=liveTx().filter(t=>t.campaign_id===c.id);
  const paid=tx.reduce((s,t)=>s+num(t.amount),0), pledged=pl.reduce((s,p)=>s+num(p.amount),0);
  const paidOnPledges=pl.reduce((s,p)=>s+Math.min(num(p.amount),tx.filter(t=>t.member_id===p.member_id).reduce((a,t)=>a+num(t.amount),0)),0);
  return {pl,tx,paid,pledged,promisedUnpaid:Math.max(0,pledged-paidOnPledges)};
}
function fundView(){
  if(S.camp){ const c=S.camps.find(x=>x.id===S.camp); if(c) return campView(c); S.camp=null; }
  const list=S.camps.filter(c=>inScope(c.unit_id));
  return `<div class="pagehead"><h2>Fundraising</h2><span class="muted">Targets, pledges and how much has been paid.</span></div>
  <div class="stack" style="max-width:880px">${list.map(c=>{const s=campStats(c), tgt=num(c.target)||1;
    return `<button class="card" style="text-align:left;cursor:pointer" data-act="camp" data-id="${c.id}"><div class="cardhead"><h3>${esc(c.name)}</h3><span class="muted">${esc(uName(c.unit_id))}${c.ends_on?' · ends '+dLong(c.ends_on):''}</span></div>
      <div class="bar"><span><b class="num" style="font-size:18px">${fmt(s.paid)}</b> <span class="muted">raised of ${fmt(c.target)}</span></span><b class="num">${Math.round(s.paid/tgt*100)}%</b>
      <div class="track"><div class="fill soft" style="width:${Math.min(100,(s.paid+s.promisedUnpaid)/tgt*100)}%"></div><div class="fill" style="width:${Math.min(100,s.paid/tgt*100)}%"></div></div></div>
      <span class="muted">${s.pl.length} pledge${s.pl.length===1?'':'s'} · ${fmt(s.promisedUnpaid)} promised but not paid yet</span></button>`}).join('')||'<div class="card"><div class="empty"><b>No fundraising yet</b><span class="muted">Start one for harvest, a building fund or an anniversary.</span></div></div>'}
    ${canWrite()?`<button class="btn ghost" style="align-self:flex-start" data-act="sheet" data-t="camp">＋ Start a fundraising</button>`:''}</div>`;
}
function campView(c){
  const s=campStats(c), tgt=num(c.target)||1;
  const paidBy=mid=>s.tx.filter(t=>t.member_id===mid).reduce((a,t)=>a+num(t.amount),0);
  const extra=s.tx.filter(t=>!t.member_id||!s.pl.some(p=>p.member_id===t.member_id)).reduce((a,t)=>a+num(t.amount),0);
  return `<button class="back" data-act="camp" data-id="">‹ Fundraising</button>
  <div class="pagehead" style="margin-top:8px"><h2 style="display:block">${esc(c.name)}</h2><span class="muted">${esc(uName(c.unit_id))}${c.ends_on?' · ends '+dLong(c.ends_on):''}</span></div>
  <div class="stack">
    <div class="tiles"><div class="tile"><span>Target</span><b>${fmt(c.target)}</b></div><div class="tile"><span>Raised</span><b>${fmt(s.paid)}</b></div><div class="tile"><span>Promised, not paid</span><b>${fmt(s.promisedUnpaid)}</b></div><div class="tile"><span>Still needed</span><b>${fmt(Math.max(0,num(c.target)-s.paid))}</b></div></div>
    <div class="card"><div class="legend"><span><i class="sw"></i>Paid</span><span><i class="sw" style="opacity:.3;height:8px"></i>Promised</span></div>
      <div class="track" style="height:14px"><div class="fill soft" style="width:${Math.min(100,(s.paid+s.promisedUnpaid)/tgt*100)}%"></div><div class="fill" style="width:${Math.min(100,s.paid/tgt*100)}%"></div></div></div>
    <div class="card"><div class="cardhead"><h3>Pledges</h3><span class="muted">${fmt(extra)} given without a pledge</span></div>
      ${s.pl.length?`<div class="tbl"><table><thead><tr><th>Member</th><th>Promised</th><th>Paid</th><th>Balance</th><th></th></tr></thead><tbody>
      ${s.pl.map(p=>{const pd=paidBy(p.member_id), bal=num(p.amount)-pd; return `<tr><td>${esc(memberName(p.member_id))}</td><td>${num(p.amount).toLocaleString('en-US')}</td><td>${pd.toLocaleString('en-US')}</td><td class="${bal>0?'neg':'pos'}">${bal>0?bal.toLocaleString('en-US'):'Paid ✓'}</td><td>${canWrite()&&bal>0?`<button class="btn small ghost" data-act="sheet" data-t="pledgepay" data-id="${c.id}" data-member="${p.member_id}">Record payment</button>`:''}</td></tr>`}).join('')}
      </tbody></table></div>`:'<span class="muted">No pledges yet.</span>'}
      ${canWrite()?`<div class="btnrow"><button class="btn small" data-act="sheet" data-t="pledge" data-id="${c.id}">＋ Add a pledge</button><button class="btn small ghost" data-act="sheet" data-t="pledgepay" data-id="${c.id}">＋ Record a gift</button></div>`:''}</div>
  </div>`;
}

/* ---- Services & programs ---- */
function servicesView(){
  if(S.service){ const s=svcById(S.service); if(s) return serviceDetail(s); S.service=null; }
  if(S.program){ const p=progById(S.program); if(p) return programDetail(p); S.program=null; }
  const seg=`<div class="seg" role="group" aria-label="Show"><button data-act="svctab" data-id="services" aria-pressed="${S.svcTab==='services'}">Services</button><button data-act="svctab" data-id="programs" aria-pressed="${S.svcTab==='programs'}">Programs & events</button></div>`;
  let body;
  if(S.svcTab==='services'){
    const list=S.services.filter(s=>inScope(s.unit_id));
    let lastM='', rows='';
    list.forEach(s=>{ const m=s.service_date.slice(0,7); if(m!==lastM){ lastM=m; rows+=`<div class="navlab" style="padding:12px 0 2px">${MONTHS[+m.slice(5,7)-1]} ${m.slice(0,4)}</div>`; }
      const inc=sumAmt(svcTx(s.id)), ex=sumAmt(svcEx(s.id).filter(counted)), p=progById(s.program_id);
      rows+=`<button class="item" data-act="opensvc" data-id="${s.id}"><span class="av">${+s.service_date.slice(8,10)}</span><span class="t"><b>${esc(s.title||s.kind)}</b><small>${dLong(s.service_date)} · ${esc(uName(s.unit_id))}${p?' · '+esc(p.name):''}</small></span><span class="right"><span class="amt num">${fmt(inc-ex)}</span><span class="muted num">in ${short(inc)} · out ${short(ex)}</span></span><span class="chev">›</span></button>`; });
    body=`<div class="card"><div class="list">${rows||`<div class="empty"><b>No services yet</b><span class="muted">Create a service for each Sunday, evening or midweek gathering. Then record its offering, thanksgiving, fundraising, Day Born and expenses together on one page.</span></div>`}</div></div>`;
  } else {
    const list=S.programs.filter(p=>inScope(p.unit_id));
    body=`<div class="card"><div class="list">${list.map(p=>{const inc=sumAmt(progTx(p)), ex=sumAmt(progEx(p).filter(counted)), [c,l]=progStatus(p);
      return `<button class="item" data-act="openprog" data-id="${p.id}"><span class="av">🎪</span><span class="t"><b>${esc(p.name)}</b><small>${dShort(p.starts_on)} – ${dLong(p.ends_on)} · ${esc(uName(p.unit_id))}</small></span><span class="right"><span class="amt num">${fmt(inc-ex)}</span><span class="chip ${c}">${l}</span></span><span class="chev">›</span></button>`}).join('')||`<div class="empty"><b>No programs yet</b><span class="muted">A program runs over several days, such as a convention, harvest week or crusade. It keeps its own income, expenses and details: theme, speakers, team and venue.</span></div>`}</div></div>`;
  }
  return `<div class="pagehead row"><div><h2>Services</h2><span class="muted">${esc(scopeLabel())} · each service keeps its own income and expenses</span></div>
    ${canWrite()?`<div class="btnrow"><button class="btn" data-act="sheet" data-t="newservice">＋ New service</button><button class="btn ghost" data-act="sheet" data-t="program">＋ New program</button></div>`:''}</div>
  <div class="stack" style="max-width:880px">${seg}${body}</div>`;
}
function serviceDetail(s){
  const tx=svcTx(s.id), ex=svcEx(s.id), inc=sumAmt(tx), out=sumAmt(ex.filter(counted)), pend=ex.filter(e=>e.status==='pending'), p=progById(s.program_id), db=dbForService(s.id);
  const camps=S.camps.filter(c=>c.unit_id===s.unit_id);
  const d=S.svcDraft, inp=(k,ph)=>`<input type="number" inputmode="decimal" min="0" data-svc="${esc(k)}" value="${esc(d[k]||'')}" placeholder="${ph||'0.00'}" style="text-align:right">`;
  const itemRows=svcItems().map(it=>{
    const done=tx.filter(t=>t.category===it), doneTxt=done.length?`<small>Recorded: ${fmt(sumAmt(done))}</small>`:'';
    if(it==='Day Born'){ if(!dayBornAllowedFor(s.unit_id)) return '';
      return `<div class="day"><div><b>Day Born</b><small>${db?`Recorded: ${fmt(db.amounts.reduce((a,v)=>a+num(v),0))} (8 groups)`:'8 day groups'}</small></div>${db?`<button class="btn small ghost" data-act="tab" data-id="dayborn">View</button>`:`<button class="btn small" data-act="sheet" data-t="dayentry" data-id="${s.id}">Enter 8 groups</button>`}</div>`; }
    if(it==='Fundraising') return `<div class="day"><div><b>Fundraising</b>${doneTxt}${camps.length?`<select id="svccamp" style="margin-top:6px;padding:6px 8px"><option value="">General (no campaign)</option>${camps.map(c=>`<option value="${c.id}" ${d.__camp===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select>`:''}</div>${inp('Fundraising')}</div>`;
    return `<div class="day"><div><b>${esc(it)}</b>${doneTxt}</div>${inp(it)}</div>`;
  }).join('');
  const draftTotal=Object.entries(d).filter(([k])=>!k.startsWith('__')).reduce((a,[,v])=>a+(parseFloat(v)||0),0)+(parseFloat(d.__otherAmt)||0);
  return `<button class="back" data-act="closesvc">‹ Services</button>
  <div class="pagehead" style="margin-top:8px"><h2 style="display:block">${esc(s.title||s.kind)}</h2><span class="muted">${dLong(s.service_date)} · ${esc(uName(s.unit_id))}${s.title?' · '+esc(s.kind):''}</span>
    <div class="chips">${p?`<button class="chip gold" data-act="openprog" data-id="${p.id}" style="border:0;cursor:pointer">🎪 ${esc(p.name)}</button>`:''}${s.counter1||s.counter2?`<span class="chip">Counted by ${esc([s.counter1,s.counter2].filter(Boolean).join(' & '))}</span>`:''}</div></div>
  <div class="stack">
    <div class="tiles">
      <div class="tile"><span>Income</span><b style="color:var(--good)">${fmt(inc)}</b><span>${tx.length} item${tx.length===1?'':'s'}</span></div>
      <div class="tile"><span>Expenses</span><b style="color:var(--bad)">${fmt(out)}</b>${pend.length?`<span>${pend.length} waiting for approval</span>`:'<span>approved</span>'}</div>
      <div class="tile"><span>Balance for this service</span><b>${fmt(inc-out)}</b><span>income − expenses</span></div>
      <div class="tile"><span>Date</span><b style="font-size:16px">${dLong(s.service_date)}</b><span>${esc(s.kind)}</span></div>
    </div>
    <div class="grid2"><div class="col">
      ${canWrite()?`<div class="card"><div class="cardhead"><h3>Record this service's money</h3>${isAdmin()?`<button class="link" data-act="tab" data-id="settings">Change items</button>`:''}</div>
        <label class="btn light" style="display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer">📷 Read a photo of my written sheet<input type="file" id="photoin" data-service="${s.id}" accept="image/*" capture="environment" hidden></label>
        <span class="muted">Take a clear photo of your written record. SikaBook reads the numbers and shows them to you to check before anything is saved. Or type them below.</span>
        <div>${itemRows}
          <div class="day"><div><b>Other</b><input type="text" data-svc="__otherCat" value="${esc(d.__otherCat||'')}" placeholder="e.g. Harvest, Welfare" style="margin-top:6px;padding:6px 8px"></div>${inp('__otherAmt')}</div>
        </div>
        <div class="row2"><label class="f">Counted by<input type="text" id="sc1" value="${esc(s.counter1||'')}" placeholder="Counter 1"></label><label class="f">&nbsp;<input type="text" id="sc2" value="${esc(s.counter2||'')}" placeholder="Counter 2"></label></div>
        <div class="sumbar"><div><span>To save now</span><b class="num" id="svctotal">${fmt(draftTotal)}</b></div><button class="btn light" data-act="savesvc" data-id="${s.id}">Save to this service</button></div>
        <span class="muted">You can come back and add more at any time. Each amount gets its own receipt.</span></div>`:''}
      <div class="card"><div class="cardhead"><h3>Expenses for this service</h3><span class="muted">${fmt(out)}</span></div>
        <div class="list">${ex.map(expRow).join('')||'<span class="muted">No expenses for this service.</span>'}</div>
        ${canWrite()?`<button class="btn ghost" style="align-self:flex-start" data-act="sheet" data-t="expnew" data-service="${s.id}">＋ Add an expense</button>`:''}</div>
    </div><div class="col">
      <div class="card"><div class="cardhead"><h3>Income recorded</h3><span class="muted">${fmt(inc)}</span></div>
        <div class="list">${tx.map(t=>`<button class="item" data-act="sheet" data-t="txn" data-id="${t.id}"><span class="t"><b>${esc(t.category)}${t.member_id?' — '+esc(memberName(t.member_id)):''}</b><small>Receipt #${t.receipt_no}${t.campaign_id?' · '+esc(S.camps.find(c=>c.id===t.campaign_id)?.name||''):''}</small></span><span class="amt num in">${fmt(t.amount)}</span></button>`).join('')||'<span class="muted">Nothing recorded yet.</span>'}</div>
        ${canWrite()?`<button class="link" style="align-self:flex-start" data-act="sheet" data-t="income" data-service="${s.id}">＋ Record a member's payment (tithe, dues…)</button>`:''}</div>
      <div class="btnrow"><button class="btn ghost" data-act="sharesvc" data-id="${s.id}">Share summary on WhatsApp</button><button class="btn ghost" data-act="print">Print / PDF</button>${canWrite()?`<button class="btn ghost" data-act="sheet" data-t="editservice" data-id="${s.id}">Edit</button>`:''}</div>
    </div></div>
  </div>`;
}
function programDetail(p){
  const tx=progTx(p), ex=progEx(p), inc=sumAmt(tx), out=sumAmt(ex.filter(counted)), [c,l]=progStatus(p), pf=progFields();
  const svcs=S.services.filter(s=>s.program_id===p.id).sort((a,b)=>a.service_date.localeCompare(b.service_date));
  const days=datesBetween(p.starts_on,p.ends_on);
  const dayRows=days.map(d=>{ const i=sumAmt(tx.filter(t=>t.txn_date===d)), o=sumAmt(ex.filter(e=>counted(e)&&e.exp_date===d)), ss=svcs.filter(s=>s.service_date===d);
    return `<tr><td>${dShort(d)} <small class="muted">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(d+'T00:00:00').getDay()]}</small></td><td style="text-align:left;white-space:normal">${ss.map(s=>`<button class="link" data-act="opensvc" data-id="${s.id}">${esc(s.title||s.kind)}</button>`).join(', ')||'<span class="muted">—</span>'}</td><td>${i.toLocaleString('en-US')}</td><td>${o.toLocaleString('en-US')}</td><td class="${i-o>=0?'pos':'neg'}">${(i-o).toLocaleString('en-US')}</td></tr>`; }).join('');
  const outside=sumAmt(tx.filter(t=>t.txn_date<p.starts_on||t.txn_date>p.ends_on));
  const details=Object.keys(PROG_LABEL).filter(k=>pf[k]&&p[k]).map(k=>`<dt>${PROG_LABEL[k]}</dt><dd style="white-space:pre-line">${esc(p[k])}</dd>`).join('')+(p.notes?`<dt>Notes</dt><dd style="white-space:pre-line">${esc(p.notes)}</dd>`:'');
  const recent=[...tx.map(t=>({k:'in',d:t.txn_date,id:t.id,t:t.category+(t.member_id?' — '+memberName(t.member_id):''),a:num(t.amount)})),...ex.map(e=>({k:'out',d:e.exp_date,id:e.id,t:`${e.paid_to} — ${e.purpose}`,a:num(e.amount),st:e.status}))].sort((a,b)=>b.d.localeCompare(a.d));
  return `<button class="back" data-act="closeprog">‹ Programs</button>
  <div class="pagehead" style="margin-top:8px"><h2 style="display:block">${esc(p.name)}</h2><span class="muted">${dLong(p.starts_on)} – ${dLong(p.ends_on)} · ${days.length} day${days.length===1?'':'s'} · ${esc(uName(p.unit_id))}</span><div class="chips"><span class="chip ${c}">${l}</span></div></div>
  <div class="stack">
    <div class="tiles">
      <div class="tile"><span>Income</span><b style="color:var(--good)">${fmt(inc)}</b></div>
      <div class="tile"><span>Expenses</span><b style="color:var(--bad)">${fmt(out)}</b></div>
      <div class="tile"><span>Balance</span><b>${fmt(inc-out)}</b></div>
      <div class="tile"><span>${p.budget!=null?'Budget left':'Services'}</span><b>${p.budget!=null?fmt(num(p.budget)-out):svcs.length}</b>${p.budget!=null?`<span>of ${fmt(p.budget)} budget</span>`:''}</div>
    </div>
    <div class="grid2"><div class="col">
      <div class="card"><div class="cardhead"><h3>Day by day</h3><span class="muted">${isDesk()?'':'scroll sideways'}</span></div>
        <div class="tbl"><table><thead><tr><th>Day</th><th style="text-align:left">Services</th><th>Income</th><th>Expenses</th><th>Balance</th></tr></thead><tbody>${dayRows}
        <tr class="total"><td>Total</td><td></td><td>${inc.toLocaleString('en-US')}</td><td>${out.toLocaleString('en-US')}</td><td>${(inc-out).toLocaleString('en-US')}</td></tr></tbody></table></div>
        ${outside?`<span class="muted">${fmt(outside)} was recorded for this program outside its dates (e.g. early pledges).</span>`:''}
        ${canWrite()?`<div class="btnrow"><button class="btn small" data-act="sheet" data-t="newservice" data-program="${p.id}">＋ Add a service / day</button><button class="btn small ghost" data-act="sheet" data-t="income" data-program="${p.id}">＋ Income</button><button class="btn small ghost" data-act="sheet" data-t="expnew" data-program="${p.id}">− Expense</button></div>`:''}</div>
      ${p.budget!=null&&num(p.budget)>0?`<div class="card"><h3>Budget</h3><div class="bar"><span>${fmt(out)} spent of ${fmt(p.budget)}</span><b class="num">${Math.round(out/num(p.budget)*100)}%</b><div class="track"><div class="fill ${out>num(p.budget)?'bad':''}" style="width:${Math.min(100,out/num(p.budget)*100)}%"></div></div></div></div>`:''}
    </div><div class="col">
      <div class="card"><div class="cardhead"><h3>Details</h3>${canWrite()?`<button class="link" data-act="sheet" data-t="program" data-id="${p.id}">Edit</button>`:''}</div>
        ${details?`<dl class="kv">${details}</dl>`:'<span class="muted">No details added. Tap Edit to add a theme, speakers, team or venue.</span>'}</div>
      <div class="card"><h3>All records</h3><div class="list">${recent.slice(0,40).map(r=>`<button class="item" data-act="sheet" data-t="${r.k==='in'?'txn':'expense'}" data-id="${r.id}"><span class="t"><b>${esc(r.t)}</b><small>${dLong(r.d)}${r.st&&r.st!=='confirmed'&&r.st!=='approved'?' · '+r.st:''}</small></span><span class="amt num ${r.k}">${r.k==='in'?'+':'−'}${short(r.a)}</span></button>`).join('')||'<span class="muted">Nothing recorded yet.</span>'}</div></div>
      <div class="btnrow"><button class="btn ghost" data-act="shareprog" data-id="${p.id}">Share summary on WhatsApp</button><button class="btn ghost" data-act="print">Print / PDF</button></div>
    </div></div>
  </div>`;
}

/* ---- Reports ---- */
function reportsView(){
  const sc=scope(), mk=S.reportMonth, start=mk+'-01', [yy,mm]=mk.split('-').map(Number), next=new Date(yy,mm,1).toLocaleDateString('en-CA');
  const t=liveTx().filter(x=>inScope(x.unit_id)&&ym(x.txn_date)===mk), ex=S.expenses.filter(x=>inScope(x.unit_id)&&counted(x)&&ym(x.exp_date)===mk);
  const inc=t.reduce((s,x)=>s+num(x.amount),0), out=ex.reduce((s,x)=>s+num(x.amount),0), open=balanceBefore(sc,start), close=balanceBefore(sc,next);
  const byCat={}; t.forEach(x=>byCat[x.category]=(byCat[x.category]||0)+num(x.amount));
  const bName=id=>S.budgets.find(b=>b.id===id)?.name;
  const byLine={}; ex.forEach(x=>{const k=bName(x.budget_id)||x.purpose; byLine[k]=(byLine[k]||0)+num(x.amount);});
  const hist=[]; for(let i=5;i>=0;i--){ const d=new Date(yy,mm-1-i,1), k=d.toLocaleDateString('en-CA').slice(0,7);
    const a=liveTx().filter(x=>inScope(x.unit_id)&&ym(x.txn_date)===k).reduce((s,x)=>s+num(x.amount),0), b=S.expenses.filter(x=>inScope(x.unit_id)&&counted(x)&&ym(x.exp_date)===k).reduce((s,x)=>s+num(x.amount),0);
    hist.push({m:MONTHS[d.getMonth()],inc:a,out:b}); }
  const mLabel=`${MONTHS[mm-1]} ${yy}`;
  return `<div class="pagehead row"><div><h2>Reports</h2><span class="muted">${esc(scopeLabel())} · ${mLabel}</span></div>
    <div class="btnrow"><input type="month" id="rmonth" value="${mk}" style="width:auto"><button class="btn small ghost" data-act="csv">Excel (CSV)</button><button class="btn small ghost" data-act="print">Print / PDF</button><button class="btn small" data-act="sharereport">Share on WhatsApp</button></div></div>
  <div class="stack"><div class="grid2"><div class="col">
    <div class="card"><h3>${esc(S.org.name)} · Statement for ${mLabel}</h3><span class="muted">${esc(scopeLabel())}</span>
      <dl class="kv"><dt>Opening balance (1 ${MONTHS[mm-1]})</dt><dd class="num">${fmt(open)}</dd></dl>
      <div class="tbl"><table><thead><tr><th>Income</th><th></th></tr></thead><tbody>${Object.entries(byCat).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<tr><td>${esc(k)}</td><td>${fmt(v)}</td></tr>`).join('')||'<tr><td class="muted">None</td><td></td></tr>'}<tr class="total"><td>Total income</td><td class="pos">${fmt(inc)}</td></tr></tbody></table></div>
      <div class="tbl"><table><thead><tr><th>Expenses</th><th></th></tr></thead><tbody>${Object.entries(byLine).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<tr><td>${esc(k)}</td><td>${fmt(v)}</td></tr>`).join('')||'<tr><td class="muted">None</td><td></td></tr>'}<tr class="total"><td>Total expenses</td><td class="neg">${fmt(out)}</td></tr></tbody></table></div>
      <dl class="kv"><dt>${inc-out>=0?'Surplus':'Deficit'} for the month</dt><dd class="num" style="color:${inc-out>=0?'var(--good)':'var(--bad)'}">${fmt(inc-out)}</dd><dt><b>Closing balance</b></dt><dd class="num"><b>${fmt(close)}</b></dd></dl>
    </div>
  </div><div class="col">
    <div class="card"><h3>Last 6 months</h3><div class="tbl"><table><thead><tr><th>Month</th><th>Income</th><th>Expenses</th><th>Surplus</th></tr></thead><tbody>
      ${hist.map(h=>`<tr><td>${h.m}</td><td>${h.inc.toLocaleString('en-US')}</td><td>${h.out.toLocaleString('en-US')}</td><td class="${h.inc-h.out>=0?'pos':'neg'}">${(h.inc-h.out).toLocaleString('en-US')}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="card"><h3>Services in ${mLabel}</h3>${(()=>{ const ss=S.services.filter(s=>inScope(s.unit_id)&&ym(s.service_date)===mk).sort((a,b)=>a.service_date.localeCompare(b.service_date));
      if(!ss.length) return '<span class="muted">No services this month.</span>';
      const r=ss.map(s=>{const i=sumAmt(svcTx(s.id)), o=sumAmt(svcEx(s.id).filter(counted)); return {s,i,o};});
      return `<div class="tbl"><table><thead><tr><th>Service</th><th>Income</th><th>Expenses</th><th>Balance</th></tr></thead><tbody>${r.map(({s,i,o})=>`<tr><td><button data-act="opensvc" data-id="${s.id}">${dShort(s.service_date)}<small>${esc(s.title||s.kind)}</small></button></td><td>${i.toLocaleString('en-US')}</td><td>${o.toLocaleString('en-US')}</td><td class="${i-o>=0?'pos':'neg'}">${(i-o).toLocaleString('en-US')}</td></tr>`).join('')}
        <tr class="total"><td>Total</td><td>${r.reduce((a,x)=>a+x.i,0).toLocaleString('en-US')}</td><td>${r.reduce((a,x)=>a+x.o,0).toLocaleString('en-US')}</td><td>${r.reduce((a,x)=>a+x.i-x.o,0).toLocaleString('en-US')}</td></tr></tbody></table></div>`; })()}</div>
    <div class="card"><h3>Income each month</h3>${barChart(hist.map(h=>h.m),hist.map(h=>h.inc),'Income each month')}</div>
  </div></div></div>`;
}

/* ---- Activity / Structure / Settings ---- */
function activityView(){
  if(!isApprover()) return `<div class="card lock"><i>🔒</i><b>Only the admin and ${esc(ROLE_LABEL('finsec'))} can see the activity log</b></div>`;
  return `<div class="pagehead"><h2>Activity</h2><span class="muted">Every change, who made it and when. Nothing can be deleted, only voided with a reason.</span></div>
  <div class="stack" style="max-width:780px"><div class="card"><div class="list">${S.logs.map(l=>`<div class="item"><span class="av">${esc((l.user_email||'?')[0].toUpperCase())}</span><span class="t"><b style="white-space:normal">${esc(({insert:'Added',update:'Changed'})[l.action]||l.action)} ${esc(l.entity.replace(/_/g,' '))}: ${esc(l.summary)}</b><small>${esc(l.user_email||'')} · ${new Date(l.at).toLocaleString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</small></span></div>`).join('')||'<span class="muted">Nothing yet.</span>'}</div></div></div>`;
}
function structureView(){
  const roots=S.units.filter(u=>!u.parent_id||!unitById(u.parent_id));
  const node=(u,depth)=>`<div class="node ${u.is_main?'on':''}" style="margin-left:${depth*18}px"><span><b>${esc(u.name)}</b> <span class="muted">· ${esc(u.level)}</span></span>
    <span class="right">${isAdmin()?`<button class="link" data-act="sheet" data-t="unit" data-id="${u.id}">Starting balance ${fmt(u.opening_balance)} ›</button>`:`<span class="muted">${fmt(u.opening_balance)}</span>`}</span></div>`+childrenOf(u.id).map(c=>node(c,depth+1)).join('');
  return `<div class="pagehead"><h2>Structure</h2><span class="muted">The ${esc(C().top.toLowerCase())} sees every ${esc(C().sub.toLowerCase())}. Each ${esc(C().sub.toLowerCase())} sees only its own money.</span></div>
  <div class="stack" style="max-width:780px"><div class="card"><div class="tree">${roots.map(r=>node(r,0)).join('')}</div>
    ${isAdmin()?'<span class="muted">Set each unit’s starting balance (the money it already had before you started using SikaBook) so the balances are right.</span>':''}</div>
  ${isAdmin()?`<div class="card"><h3>Add a ${esc(C().sub.toLowerCase())} or group</h3><input type="text" id="newunit" placeholder="Name"><button class="btn" style="align-self:flex-start" data-act="addunit">Add under ${esc(mainUnit()?.name||'')}</button></div>
  ${S.showHigher?`<div class="card"><h3>Add a higher level</h3><span class="muted">Only add this when that office starts using SikaBook. It will see the totals of everything under it.</span>
     <div class="row2"><select id="hlevel">${C().higher.map(l=>`<option>${l}</option>`).join('')}</select><input type="text" id="hname" placeholder="Name"></div>
     <div class="row2"><button class="btn ghost" data-act="hcancel">Cancel</button><button class="btn" data-act="hadd">Add level</button></div></div>`
   :`<button class="link" data-act="hshow">Add a higher level (${C().higher.join(', ')}) ›</button>`}`:''}
  </div>`;
}
function settingsView(){
  const o=S.org, f=o.features||{};
  return `<div class="pagehead"><h2>Settings</h2><span class="muted">${esc(o.name)} · signed in as ${esc(S.user.email)} (${esc(ROLE_LABEL(role()))})</span></div>
  <div class="stack" style="max-width:780px">
    ${isAdmin()?`<div class="card"><h3>General</h3>
      <label class="f">Name<input type="text" id="setname" value="${esc(o.name)}"></label>
      <label class="f">Currency<select id="setcur">${CURRENCIES.map(([c,s,n])=>`<option value="${c}" ${o.currency===c?'selected':''}>${s} · ${n} (${c})</option>`).join('')}</select></label>
      <label class="f">Type<select id="setkind"><option value="church" ${o.kind==='church'?'selected':''}>Church</option><option value="org" ${o.kind==='org'?'selected':''}>Organization</option></select></label>
      <button class="btn" style="align-self:flex-start" data-act="savesettings">Save</button></div>
    <div class="card"><h3>Features</h3>
      ${o.kind==='church'?`<label class="toggle"><span>Day Born offering<small>8 day groups every Sunday</small></span><input type="checkbox" data-feat="dayborn" ${f.dayborn?'checked':''}></label>`:''}
      <label class="toggle"><span>Pledges & fundraising</span><input type="checkbox" data-feat="pledges" ${f.pledges?'checked':''}></label></div>
    <div class="card"><h3>Service sheet</h3><span class="muted">Choose what appears on every service sheet. Untick to hide; add your own below.</span>
      <div class="checks">${[...new Set([...svcItems(),...C().income.filter(x=>x!=='Other'),...(isChurch()?['Day Born']:[])])].map(it=>`<label><input type="checkbox" name="svi" value="${esc(it)}" ${svcItems().includes(it)?'checked':''}> ${esc(it)}</label>`).join('')}</div>
      <label class="f">Add your own items <span class="muted">(separate with commas)</span><input type="text" id="sviadd" placeholder="e.g. Seed offering, Building levy"></label>
      <label class="f">Service types <span class="muted">(one per line)</span><textarea id="svkinds">${esc(svcKinds().join('\n'))}</textarea></label>
      <span class="muted">Program details to ask for</span>
      <div class="checks">${Object.entries(PROG_LABEL).map(([k,l])=>`<label><input type="checkbox" id="pf_${k}" ${progFields()[k]?'checked':''}> ${l}</label>`).join('')}</div>
      <button class="btn" style="align-self:flex-start" data-act="saveitems">Save</button></div>
    <div class="card"><h3>People who can sign in</h3><div class="list">
      ${S.orgUsers.map(u=>`<div class="item"><span class="av">${esc((u.display_name||u.email||'?')[0].toUpperCase())}</span><span class="t"><b>${esc(u.display_name||u.email)}</b><small>${esc(ROLE_LABEL(u.role))} · ${esc(accessLabel(u))}${u.user_id===S.user.id?' · you':''}</small></span>${u.user_id!==S.user.id?`<button class="btn small ghost" data-act="sheet" data-t="access" data-id="${u.id}">Change</button>`:''}</div>`).join('')}
      ${S.invites.map(v=>`<div class="item"><span class="av">✉</span><span class="t"><b>${esc(v.display_name||v.email)}</b><small>Invited · ${esc(ROLE_LABEL(v.role))} · ${esc(accessLabel(v))} · waiting for them to sign up with ${esc(v.email)}</small></span><span class="btnrow"><button class="btn small ghost" data-act="sheet" data-t="invited" data-id="${v.id}">Send link</button><button class="btn small ghost" data-act="cancelinvite" data-id="${v.id}">Cancel</button></span></div>`).join('')}
    </div><button class="btn ghost" style="align-self:flex-start" data-act="sheet" data-t="invite">＋ Invite someone</button></div>`:''}
    <div class="card"><h3>Share the app</h3><span class="muted">Send this link to people you invite. On a phone, open it and choose “Add to Home Screen”.</span><div class="linkbox">${esc(appLink())}</div><button class="btn small ghost" style="align-self:flex-start" data-act="copy" data-id="${esc(appLink())}">Copy link</button></div>
    ${S.orgs.length>1?`<div class="card"><h3>Switch</h3><select id="orgsel">${S.orgs.map(r=>`<option value="${r.org_id}" ${r.org_id===o.id?'selected':''}>${esc(r.orgs.name)}</option>`).join('')}</select></div>`:''}
    <button class="btn ghost" style="align-self:flex-start" data-act="signout">Sign out</button>
  </div>`;
}
const appLink = () => location.origin + location.pathname;

/* ===================== Sheets ===================== */
function sheetHTML(){
  const sh=S.sheet; if(!sh) return '';
  const head=t=>`<div class="sheethead"><h3>${t}</h3><button class="x" data-act="close" aria-label="Close">✕</button></div>`;
  const busy=S.busy?' disabled':'';
  switch(sh.t){
  case 'more': return `<div class="sheet" role="dialog" aria-label="More">${head('More')}<div class="menu">${MORE().map(([k,i,l])=>`<button data-act="tab" data-id="${k}"><i>${i}</i>${l}</button>`).join('')}</div></div>`;
  case 'expense': { const x=S.expenses.find(e=>e.id===sh.id); if(!x) return ''; const [c,lab]=ST[x.status]; const link=`${appLink()}?r=${x.confirm_token}`;
    const by=uid=>S.orgUsers.find(u=>u.user_id===uid); const nm=u=>u?(u.display_name||u.email):'—';
    return `<div class="sheet" role="dialog" aria-label="Expense details">${head('Expense details')}
      <div><div class="bigamt num">${fmt(x.amount)}</div>${x.voided?'<span class="chip bad">Voided</span>':`<span class="chip ${c}">${lab}</span>`}</div>
      <dl class="kv"><dt>Paid to</dt><dd>${esc(x.paid_to)}</dd><dt>For</dt><dd>${esc(x.purpose)}</dd><dt>Date</dt><dd>${dLong(x.exp_date)}</dd><dt>Unit</dt><dd>${esc(uName(x.unit_id))}</dd>
        <dt>Paid from</dt><dd>${esc(x.fund)}</dd><dt>Budget line</dt><dd>${esc(S.budgets.find(b=>b.id===x.budget_id)?.name||'—')}</dd>
        <dt>Recorded by</dt><dd>${esc(nm(by(x.created_by)))}</dd><dt>Approved by</dt><dd>${x.approved_by?esc(nm(by(x.approved_by))):'Not yet'}</dd>
        <dt>Recipient</dt><dd>${x.confirmed_at?'Confirmed '+new Date(x.confirmed_at).toLocaleDateString('en-GB'):'Not confirmed yet'}</dd>
        <dt>Receipt no.</dt><dd class="num">EXP-${x.receipt_no}</dd>${x.note?`<dt>Note</dt><dd>${esc(x.note)}</dd>`:''}${x.voided?`<dt>Void reason</dt><dd>${esc(x.void_reason||'')}</dd>`:''}</dl>
      ${!x.voided&&x.status==='pending'&&isApprover()?`<div class="row2"><button class="btn ghost" data-act="reject" data-id="${x.id}"${busy}>Reject</button><button class="btn" data-act="approve" data-id="${x.id}"${busy}>Approve</button></div>`:''}
      ${!x.voided&&x.status==='pending'&&!isApprover()?`<div class="note">The ${esc(ROLE_LABEL('finsec'))} or admin approves this.</div>`:''}
      ${!x.voided&&x.status==='approved'?`<div class="note">Send this link to ${esc(x.paid_to)}. When they open it and tap “Yes, I received it”, the payment is marked as confirmed.</div><div class="linkbox">${esc(link)}</div>
        <div class="btnrow"><a class="btn small" href="https://wa.me/?text=${encodeURIComponent(`Hello ${x.paid_to}, please confirm you received ${fmt(x.amount)} for ${x.purpose} from ${S.org.name}: ${link}`)}" target="_blank" rel="noopener">Send by WhatsApp</a><button class="btn small ghost" data-act="copy" data-id="${esc(link)}">Copy link</button>${isApprover()?`<button class="btn small ghost" data-act="markconfirmed" data-id="${x.id}">They signed a paper receipt</button>`:''}</div>`:''}
      ${!x.voided&&isApprover()?`<details><summary class="muted" style="cursor:pointer">Void this expense (mistake)</summary><div class="stack" style="margin-top:8px"><input type="text" id="vreason" placeholder="Reason, e.g. entered twice"><button class="btn danger small" style="align-self:flex-start" data-act="voidexp" data-id="${x.id}">Void expense</button></div></details>`:''}
    </div>`; }
  case 'txn': { const t=S.txs.find(e=>e.id===sh.id); if(!t) return ''; const by=S.orgUsers.find(u=>u.user_id===t.created_by);
    return `<div class="sheet" role="dialog" aria-label="Receipt">${head('Receipt #'+t.receipt_no)}
      <div><div class="bigamt num">${fmt(t.amount)}</div>${t.voided?'<span class="chip bad">Voided</span>':'<span class="chip good">Received</span>'}</div>
      <dl class="kv"><dt>Type</dt><dd>${esc(t.category)}</dd>${t.member_id?`<dt>Member</dt><dd>${esc(memberName(t.member_id))}</dd>`:''}<dt>Date</dt><dd>${dLong(t.txn_date)}</dd><dt>Unit</dt><dd>${esc(uName(t.unit_id))}</dd>
        <dt>Paid by</dt><dd>${esc(t.method||'—')}</dd>${t.campaign_id?`<dt>Fundraising</dt><dd>${esc(S.camps.find(c=>c.id===t.campaign_id)?.name||'')}</dd>`:''}<dt>Recorded by</dt><dd>${esc(by?(by.display_name||by.email):'—')}</dd>${t.note?`<dt>Note</dt><dd>${esc(t.note)}</dd>`:''}${t.voided?`<dt>Void reason</dt><dd>${esc(t.void_reason||'')}</dd>`:''}</dl>
      ${!t.voided?`<a class="btn small ghost" style="align-self:flex-start" href="https://wa.me/?text=${encodeURIComponent(`${S.org.name} — receipt #${t.receipt_no}\n${t.category}${t.member_id?' from '+memberName(t.member_id):''}: ${fmt(t.amount)} on ${dLong(t.txn_date)}. Thank you and God bless.`)}" target="_blank" rel="noopener">Share receipt on WhatsApp</a>`:''}
      ${!t.voided&&isApprover()&&t.category!=='Day Born'?`<details><summary class="muted" style="cursor:pointer">Void this entry (mistake)</summary><div class="stack" style="margin-top:8px"><input type="text" id="vreason" placeholder="Reason, e.g. wrong amount"><button class="btn danger small" style="align-self:flex-start" data-act="voidtx" data-id="${t.id}">Void entry</button></div></details>`:''}
    </div>`; }
  case 'income': { const m=sh.member?S.members.find(x=>x.id===sh.member):null; const us=writableUnits(); const sv=svcById(sh.service), pr=progById(sh.program);
    const defU=sv?sv.unit_id:pr?pr.unit_id:m?(unitsOfMember(m.id).find(u=>us.some(w=>w.id===u))||us[0]?.id):(S.view!=='all'?S.view:mainUnit()?.id);
    return `<div class="sheet" role="dialog" aria-label="Record income">${head('Record income')}
      ${ctxLine(sv,pr)}
      ${sv?`<input type="hidden" id="iu" value="${sv.unit_id}">`:unitPicker('iu', defU)}
      <label class="f">Type<input type="text" id="it" list="itlist" value="${esc(sv?C().tithe:C().income[0])}"><datalist id="itlist">${C().income.map(t=>`<option value="${esc(t)}">`).join('')}</datalist></label>
      <label class="f">Member (optional)<select id="im"><option value="">— No member —</option>${membersInScope().map(x=>`<option value="${x.id}" ${m&&m.id===x.id?'selected':''}>${esc(x.full_name)}</option>`).join('')}</select></label>
      <div class="row2"><label class="f">Amount (${curSym()})<input type="number" id="ia" inputmode="decimal" placeholder="0.00"></label><label class="f">Date<input type="date" id="id" value="${sv?sv.service_date:todayISO()}"></label></div>
      <div class="row2"><label class="f">Paid by<select id="ipm"><option>Cash</option><option>Mobile Money</option><option>Bank transfer</option><option>Cheque</option></select></label><label class="f">Note<input type="text" id="in" placeholder="Optional"></label></div>
      ${!sv?progSelect('ip',sh.program):''}
      <button class="btn" data-act="saveincome"${busy}>Save</button></div>`; }
  case 'expnew': { const sv=svcById(sh.service), pr=progById(sh.program);
    return `<div class="sheet" role="dialog" aria-label="Record expense">${head('Record expense')}
      ${ctxLine(sv,pr)}
      ${sv?`<input type="hidden" id="xu" value="${sv.unit_id}">`:unitPicker('xu', pr?.unit_id)}
      <label class="f">Paid to<input type="text" id="xto" placeholder="Person, shop or project"></label>
      <label class="f">What for<input type="text" id="xline" placeholder="e.g. Refreshments"></label>
      <div class="row2"><label class="f">Amount (${curSym()})<input type="number" id="xa" inputmode="decimal" placeholder="0.00"></label><label class="f">Date<input type="date" id="xd" value="${sv?sv.service_date:todayISO()}"></label></div>
      ${!sv?progSelect('xp',sh.program):''}
      <label class="f">Paid from<input type="text" id="xf" list="xflist" value="${esc(sh.fund||'General fund')}"><datalist id="xflist">${FUNDS.map(f=>`<option value="${esc(f)}">`).join('')}</datalist></label>
      <label class="f">Budget line<select id="xb"><option value="">— None —</option>${budgetRows().map(b=>`<option value="${b.id}">${esc(b.name)} · ${esc(uName(b.unit_id))}</option>`).join('')}</select></label>
      <label class="f">Note<input type="text" id="xn" placeholder="Optional"></label>
      <div class="note">The expense waits for approval before it counts against the balance and budget.</div>
      <button class="btn" data-act="saveexp"${busy}>Save expense</button></div>`; }
  case 'pay': { const l=S.lines.find(x=>x.id===sh.id), p=S.payees.find(x=>x.id===l?.payee_id); if(!l||!p) return '';
    return `<div class="sheet" role="dialog" aria-label="Pay">${head(`Pay ${esc(p.name)}`)}<span class="muted">${esc(l.name)} · ${esc(l.frequency||'')}</span>
      <div class="row2"><label class="f">Amount (${curSym()})<input type="number" id="pa" value="${num(l.amount)}" inputmode="decimal"></label><label class="f">Date<input type="date" id="pd" value="${todayISO()}"></label></div>
      <label class="f">Paid from<input type="text" id="pf" list="xflist" value="General fund"><datalist id="xflist">${FUNDS.map(f=>`<option value="${esc(f)}">`).join('')}</datalist></label>
      <label class="f">Note<input type="text" id="pn" placeholder="Optional"></label>
      <button class="btn" data-act="savepay" data-id="${l.id}"${busy}>Record payment</button></div>`; }
  case 'payee': { const k=S.spendKind==='project'?'project':'person';
    return `<div class="sheet" role="dialog" aria-label="Add">${head(k==='person'?'Add a person':'Add a project')}
      ${unitPicker('pyu')}<label class="f">Name<input type="text" id="pyn" placeholder="${k==='person'?'e.g. Station Minister':'e.g. Chapel Building Project'}"></label>
      <label class="f">Note<input type="text" id="pynote" placeholder="${k==='person'?'e.g. Rev. Minister':'e.g. Phase 1'}"></label>
      <button class="btn" data-act="savepayee" data-id="${k}"${busy}>Add</button></div>`; }
  case 'line': { const p=S.payees.find(x=>x.id===sh.id); if(!p) return '';
    return `<div class="sheet" role="dialog" aria-label="Add line">${head(`Add a line · ${esc(p.name)}`)}
      <label class="f">Name<input type="text" id="ln" placeholder="${p.kind==='person'?'e.g. Weekly support':'e.g. Cement & blocks'}"></label>
      <div class="row2"><label class="f">Usual amount (${curSym()})<input type="number" id="la" inputmode="decimal"></label><label class="f">How often<select id="lf"><option>Every week</option><option>Monthly</option><option>Quarterly</option><option>One-off</option><option>As needed</option></select></label></div>
      <label class="f">Counts toward budget line<select id="lb"><option value="">— None —</option>${S.budgets.filter(b=>b.unit_id===p.unit_id&&b.year===YEAR).map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></label>
      <button class="btn" data-act="saveline" data-id="${p.id}"${busy}>Add line</button></div>`; }
  case 'dayentry': { const total=S.sunday.reduce((s,v)=>s+(parseFloat(v)||0),0), rows=dbRows(), last=rows[rows.length-1], sv=svcById(sh.id);
    return `<div class="sheet" role="dialog" aria-label="Day Born count">${head('Day Born count')}
      ${sv?`${ctxLine(sv)}<input type="hidden" id="dsun" value="${sv.service_date}">`:`<label class="f">Date<input type="date" id="dsun" value="${lastSunday()}"></label>`}
      <div>${DAYS.map((d,i)=>`<div class="day"><div><b>${d.d==='Unknown'?'No day name':d.d}</b><small>${d.f?`${d.m} · ${d.f}`:'Day not known'}${last?` · last time ${last.amts[i]}`:''}</small></div><input type="number" inputmode="decimal" min="0" id="day${i}" data-day="${i}" placeholder="0.00" value="${esc(S.sunday[i])}" aria-label="${d.d} amount"></div>`).join('')}</div>
      <div class="row2"><label class="f">Counted by<input type="text" id="c1" placeholder="Counter 1"></label><label class="f">&nbsp;<input type="text" id="c2" placeholder="Counter 2"></label></div>
      <div class="sumbar"><div><span>Day Born total</span><b class="num" id="stotal">${fmt(total)}</b></div><button class="btn light" data-act="savesunday" data-id="${sv?.id||''}"${busy}>Save count</button></div></div>`; }
  case 'newservice': case 'editservice': { const s=sh.t==='editservice'?svcById(sh.id):null, pr=progById(sh.program||s?.program_id);
    const kinds=svcKinds(), kind=s?.kind||kinds[0], other=s&&!kinds.includes(s.kind);
    const defDate=s?.service_date||(pr?(todayISO()>=pr.starts_on&&todayISO()<=pr.ends_on?todayISO():pr.starts_on):(new Date().getDay()===0?todayISO():todayISO()));
    return `<div class="sheet" role="dialog" aria-label="Service">${head(s?'Edit service':'New service')}
      ${s?'':unitPicker('svu', pr?.unit_id||mainUnit()?.id)}
      <div class="row2"><label class="f">Date<input type="date" id="svd" value="${defDate}"></label>
      <label class="f">Type<select id="svk">${kinds.map(k=>`<option ${k===kind?'selected':''}>${esc(k)}</option>`).join('')}<option value="__other" ${other?'selected':''}>Other…</option></select></label></div>
      <label class="f">Name <span class="muted">(optional, e.g. “Harvest Thanksgiving Service”${other?'':' or type the other service type'})</span><input type="text" id="svt" value="${esc(s?.title||(other?s.kind:''))}"></label>
      ${progSelect('svp', pr?.id)}
      <button class="btn" data-act="${s?'updservice':'createservice'}" data-id="${s?.id||''}"${busy}>${s?'Save':'Create service'}</button></div>`; }
  case 'program': { const p=progById(sh.id), pf=progFields();
    return `<div class="sheet" role="dialog" aria-label="Program">${head(p?'Edit program':'New program')}
      ${p?'':unitPicker('pru')}
      <label class="f">Name<input type="text" id="prn" value="${esc(p?.name||'')}" placeholder="e.g. Annual Convention ${YEAR}"></label>
      <div class="row2"><label class="f">From<input type="date" id="prs" value="${p?.starts_on||todayISO()}"></label><label class="f">To<input type="date" id="pre" value="${p?.ends_on||todayISO()}"></label></div>
      <label class="f">Budget (${curSym()}) <span class="muted">(optional)</span><input type="number" id="prb" inputmode="decimal" value="${p?.budget??''}"></label>
      <details ${p&&(p.theme||p.speakers||p.team||p.venue||p.notes)?'open':''}><summary class="link" style="cursor:pointer">More details (optional)</summary><div class="stack" style="margin-top:8px">
        ${pf.theme?`<label class="f">Theme<input type="text" id="prt" value="${esc(p?.theme||'')}"></label>`:''}
        ${pf.speakers?`<label class="f">Speakers <span class="muted">(one per line)</span><textarea id="prsp">${esc(p?.speakers||'')}</textarea></label>`:''}
        ${pf.team?`<label class="f">Organising team <span class="muted">(one per line)</span><textarea id="prtm">${esc(p?.team||'')}</textarea></label>`:''}
        ${pf.venue?`<label class="f">Venue<input type="text" id="prv" value="${esc(p?.venue||'')}"></label>`:''}
        <label class="f">Notes<textarea id="prno">${esc(p?.notes||'')}</textarea></label>
      </div></details>
      <button class="btn" data-act="saveprog" data-id="${p?.id||''}"${busy}>${p?'Save':'Create program'}</button></div>`; }
  case 'member': case 'editmember': { const m=sh.t==='editmember'?S.members.find(x=>x.id===sh.id):null; const mine=m?unitsOfMember(m.id):[S.view!=='all'?S.view:mainUnit()?.id];
    return `<div class="sheet" role="dialog" aria-label="Member">${head(m?'Edit member':'Add a member')}
      <label class="f">Full name<input type="text" id="mn" value="${esc(m?.full_name||'')}"></label>
      <div class="row2"><label class="f">Phone<input type="text" id="mp" inputmode="tel" value="${esc(m?.phone||'')}"></label><label class="f">Gender<select id="mg"><option value="">—</option><option value="M" ${m?.gender==='M'?'selected':''}>Male</option><option value="F" ${m?.gender==='F'?'selected':''}>Female</option></select></label></div>
      ${S.org.kind==='church'?`<label class="f">Day born<select id="md"><option value="">—</option>${DAYS.map(d=>`<option value="${d.d}" ${m?.day_born===d.d?'selected':''}>${d.d==='Unknown'?'Does not know':`${d.d} (${d.m}/${d.f})`}</option>`).join('')}</select></label>`:''}
      ${m?`<label class="toggle"><span>Active member</span><input type="checkbox" id="mact" ${m.active?'checked':''}></label>`:`<div class="f"><span class="muted">Belongs to</span><div class="checks">${writableUnits().map(u=>`<label><input type="checkbox" name="mu" value="${u.id}" ${mine.includes(u.id)?'checked':''}> ${esc(u.name)}</label>`).join('')}</div></div>`}
      <button class="btn" data-act="${m?'updmember':'addmember'}" data-id="${m?.id||''}"${busy}>${m?'Save':'Add member'}</button></div>`; }
  case 'camp': return `<div class="sheet" role="dialog" aria-label="Fundraising">${head('Start a fundraising')}${unitPicker('cu')}
      <label class="f">Name<input type="text" id="cn" placeholder="e.g. Harvest ${YEAR}"></label>
      <div class="row2"><label class="f">Target (${curSym()})<input type="number" id="ct" inputmode="decimal"></label><label class="f">Ends on<input type="date" id="ce"></label></div>
      <button class="btn" data-act="savecamp"${busy}>Start</button></div>`;
  case 'pledge': { const c=S.camps.find(x=>x.id===sh.id);
    return `<div class="sheet" role="dialog" aria-label="Pledge">${head('Add a pledge · '+esc(c?.name||''))}
      <label class="f">Member<select id="plm">${membersInScope().map(m=>`<option value="${m.id}">${esc(m.full_name)}</option>`).join('')}</select></label>
      <label class="f">Amount promised (${curSym()})<input type="number" id="pla" inputmode="decimal"></label>
      <button class="btn" data-act="savepledge" data-id="${sh.id}"${busy}>Save pledge</button></div>`; }
  case 'pledgepay': { const c=S.camps.find(x=>x.id===sh.id);
    return `<div class="sheet" role="dialog" aria-label="Payment">${head('Fundraising payment · '+esc(c?.name||''))}
      <label class="f">Member<select id="ppm"><option value="">— No member (general gift) —</option>${membersInScope().map(m=>`<option value="${m.id}" ${sh.member===m.id?'selected':''}>${esc(m.full_name)}</option>`).join('')}</select></label>
      <div class="row2"><label class="f">Amount (${curSym()})<input type="number" id="ppa" inputmode="decimal"></label><label class="f">Paid by<select id="ppw"><option>Cash</option><option>Mobile Money</option><option>Bank transfer</option><option>Cheque</option></select></label></div>
      <button class="btn" data-act="savepledgepay" data-id="${sh.id}"${busy}>Save payment</button></div>`; }
  case 'unit': { const u=unitById(sh.id); if(!u) return '';
    return `<div class="sheet" role="dialog" aria-label="Unit">${head(esc(u.name))}
      <label class="f">Name<input type="text" id="un" value="${esc(u.name)}"></label>
      <label class="f">Starting balance (${curSym()}) <span class="muted">— money it had before using SikaBook</span><input type="number" id="ub" value="${num(u.opening_balance)}" inputmode="decimal"></label>
      <button class="btn" data-act="saveunit" data-id="${u.id}"${busy}>Save</button></div>`; }
  case 'photo': { const P=S.photo; if(!P) return ''; const sv=svcById(P.service);
    if(P.loading) return `<div class="sheet" role="dialog" aria-label="Reading photo">${head('Reading your sheet…')}${P.url?`<img src="${P.url}" alt="Your photo" style="max-height:220px;object-fit:contain;border-radius:12px">`:''}<div class="loading" style="min-height:80px">This takes a few seconds…</div></div>`;
    if(P.error) return `<div class="sheet" role="dialog" aria-label="Photo">${head('Could not read the photo')}<div class="note">${esc(P.error)}</div><span class="muted">Try a brighter photo taken straight from above, or type the numbers in by hand.</span></div>`;
    const R=P.result||{}, items=(R.items||[]).filter(x=>x&&x.amount>0), exps=(R.expenses||[]).filter(x=>x&&x.amount>0);
    const dbKeys=['sunday','monday','tuesday','wednesday','thursday','friday','saturday','unknown'], db=R.dayborn||{};
    const dbAllowed=sv&&dayBornAllowedFor(sv.unit_id)&&!dbForService(sv.id), dbHas=dbKeys.some(k=>num(db[k])>0);
    const known=svcItems().filter(x=>x!=='Day Born'), match=n=>{ const l=String(n||'').toLowerCase(); return known.find(k=>k.toLowerCase()===l)||known.find(k=>l.includes(k.toLowerCase())||k.toLowerCase().includes(l))||String(n||'').trim(); };
    const dateWarn=R.date&&sv&&R.date!==sv.service_date?`<div class="note">The sheet says <b>${dLong(R.date)}</b> but this service is on <b>${dLong(sv.service_date)}</b>. Everything will be saved to this service.</div>`:'';
    return `<div class="sheet" role="dialog" aria-label="Check the numbers">${head('Check the numbers')}
      <div class="note">Compare with your sheet and fix anything that's wrong. Nothing is saved until you tap Save.${(R.unsure||[]).length?` <b>Hard to read:</b> ${esc(R.unsure.join(', '))}.`:''}</div>
      ${P.url?`<details><summary class="link" style="cursor:pointer">Show my photo</summary><img src="${P.url}" alt="Your photo" style="margin-top:8px;max-height:380px;width:100%;object-fit:contain;border-radius:12px"></details>`:''}
      ${dateWarn}
      <h3>Income</h3>
      ${items.map((x,i)=>`<div class="row2" style="grid-template-columns:1.4fr 1fr auto;align-items:center"><input type="text" id="phc${i}" value="${esc(match(x.name))}" list="itlist"><input type="number" inputmode="decimal" id="pha${i}" value="${num(x.amount)}" style="text-align:right"><input type="checkbox" id="phk${i}" checked style="width:20px;height:20px;accent-color:var(--brand-2)" aria-label="Include"></div>`).join('')||'<span class="muted">No income lines found.</span>'}
      <datalist id="itlist">${[...new Set([...known,...C().income])].map(t=>`<option value="${esc(t)}">`).join('')}</datalist>
      ${dbAllowed&&dbHas?`<h3>Day Born</h3><div>${DAYS.map((d,i)=>`<div class="day"><div><b>${d.d==='Unknown'?'No day name':d.d}</b><small>${d.f?`${d.m} · ${d.f}`:'Day not known'}</small></div><input type="number" inputmode="decimal" id="phd${i}" value="${db[dbKeys[i]]??''}" placeholder="0" style="text-align:right"></div>`).join('')}</div>`:''}
      ${dbHas&&!dbAllowed?`<div class="note">${sv&&dbForService(sv.id)?'Day Born is already saved for this service, so the Day Born numbers in the photo will be skipped.':'Day Born was found, but this unit does not record Day Born.'}</div>`:''}
      ${exps.length?`<h3>Expenses <span class="muted" style="font-weight:400">(saved as waiting for approval)</span></h3>${exps.map((x,i)=>`<div class="stack" style="margin-top:0;gap:6px;padding:8px 0;border-top:1px solid var(--line)"><div class="row2"><input type="text" id="pxt${i}" value="${esc(x.paid_to||'')}" placeholder="Paid to"><input type="text" id="pxp${i}" value="${esc(x.purpose||'')}" placeholder="What for"></div><div class="row2" style="grid-template-columns:1fr auto;align-items:center"><input type="number" inputmode="decimal" id="pxa${i}" value="${num(x.amount)}" style="text-align:right"><input type="checkbox" id="pxk${i}" checked style="width:20px;height:20px;accent-color:var(--brand-2)" aria-label="Include"></div></div>`).join('')}`:''}
      ${(R.counters||[]).length?`<span class="muted">Counted by: ${esc(R.counters.join(', '))}</span>`:''}
      <div class="sumbar"><div><span>Untick anything you don't want saved</span></div><button class="btn light" data-act="savephoto"${busy}>Save to this service</button></div></div>`; }
  case 'invite': case 'access': { const u=sh.t==='access'?S.orgUsers.find(x=>x.id===sh.id):null;
    return `<div class="sheet" role="dialog" aria-label="Access">${head(u?`Access for ${esc(u.display_name||u.email)}`:'Give someone an account')}
      ${u?`<span class="muted">${esc(u.email||'')}</span>`:`<label class="f">Their name<input type="text" id="ivn" placeholder="e.g. Choir Treasurer"></label>
      <label class="f">Their email <span class="muted">(they sign up with this)</span><input type="email" id="ive" placeholder="name@gmail.com"></label>`}
      ${accessFields(u)}
      <button class="btn" data-act="${u?'saveaccess':'saveinvite'}" data-id="${u?.id||''}"${busy}>${u?'Save access':'Create invite'}</button>
      ${u?`<button class="btn danger" data-act="removeuser" data-id="${u.id}">Remove this person</button>`:''}</div>`; }
  case 'invited': { const v=S.invites.find(x=>x.id===sh.id); if(!v) return ''; const msg=inviteMessage(v);
    return `<div class="sheet" role="dialog" aria-label="Invite link">${head('Send them the link')}
      <div class="note">${esc(v.display_name||v.email)} can now sign up. Send this message so they know what to do.</div>
      <div class="linkbox" style="white-space:pre-line">${esc(msg)}</div>
      <div class="btnrow"><a class="btn small" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">Send by WhatsApp</a><button class="btn small ghost" data-act="copy" data-id="${esc(msg)}">Copy message</button></div></div>`; }
  }
  return '';
}

/* ===================== Render ===================== */
const MAIN = () => [['home','⌂','Home'],['services','▦','Services'],['members','👥','Members'],['spend','⇄','Expenses'],['budget','◔','Budget']];
const MORE = () => [...(canDayBorn()?[['dayborn','☀','Day Born']]:[]),...(feat('pledges')?[['fund','◎','Fundraising']]:[]),['reports','▤','Reports'],...(isApprover()?[['activity','↺','Activity']]:[]),['structure','⋔','Structure'],['settings','⚙','Settings']];
const TITLES = {home:'Home',services:'Services & programs',members:'Members',dayborn:'Day Born',spend:'Expenses',budget:'Budget',fund:'Fundraising',reports:'Reports',activity:'Activity',structure:'Structure',settings:'Settings'};
function render(){
  const root=$('root'), tabsEl=$('tabs'), layer=$('layer');
  const token = new URLSearchParams(location.search).get('r');
  if(token){ document.body.dataset.layout='setup'; tabsEl.innerHTML=''; return; }
  if(S.loading){ root.innerHTML='<div class="loading">Loading SikaBook…</div>'; tabsEl.innerHTML=''; return; }
  if(!S.user || S.recovery){ document.body.dataset.layout='setup'; root.innerHTML=authView(); tabsEl.innerHTML=''; layer.innerHTML=''; return; }
  if(!S.org){ document.body.dataset.layout='setup'; root.innerHTML=setupView(); tabsEl.innerHTML=''; layer.innerHTML=''; return; }
  const desk=isDesk(); document.body.dataset.layout=desk?'desk':'phone';
  if(S.tab==='dayborn'&&!canDayBorn()) S.tab='home';
  if(S.tab==='fund'&&!feat('pledges')) S.tab='home';
  const views={home,services:servicesView,members:membersView,dayborn:dayBornView,spend:spendView,budget:budgetView,fund:fundView,reports:reportsView,activity:activityView,structure:structureView,settings:settingsView};
  const unitSel=S.units.length>1?`<select class="unitsel" id="unitsel" aria-label="Unit">${['all',...S.units.map(u=>u.id)].map(id=>`<option value="${id}" ${S.view===id?'selected':''}>${id==='all'?esc(S.me?.unit_id?'All my units':C().all):esc(uName(id))}</option>`).join('')}</select>`:`<span class="chip">${esc(S.units[0]?.name||'')}</span>`;
  const navBtn=([k,i,l])=>`<button data-act="tab" data-id="${k}" ${S.tab===k?'aria-current="page"':''}><i>${i}</i>${l}</button>`;
  const content=views[S.tab]();
  const quickBtns=canWrite()?`<div class="btnrow"><button class="btn ghost" data-act="sheet" data-t="income">＋ Income</button><button class="btn ghost" data-act="sheet" data-t="expnew">− Expense</button></div>`:'';
  const layoutToggle=window.innerWidth>=900?`<div class="seg" role="group" aria-label="Layout"><button data-act="layout" data-id="desk" aria-pressed="${!S.forcePhone}">Laptop</button><button data-act="layout" data-id="phone" aria-pressed="${S.forcePhone}">Phone</button></div>`:'';
  root.innerHTML = desk
    ? `<div class="shell"><aside class="side"><div class="logo"><i>₵</i><span>SikaBook</span></div><span class="orgname">${esc(S.org.name)}</span>${unitSel}
        <nav aria-label="Main">${MAIN().map(navBtn).join('')}<span class="navlab">More</span>${MORE().map(navBtn).join('')}</nav>
        <span class="muted" style="font-size:12px">${esc(S.user.email)} · ${esc(ROLE_LABEL(role()))}</span>${layoutToggle}</aside>
        <main class="main"><div class="deskhead"><div><span class="muted">${esc(scopeLabel())}</span><h1>${TITLES[S.tab]}</h1></div>${quickBtns}</div>${content}</main></div>`
    : `<div class="shell"><main class="main">${S.forcePhone?`<div class="demo"><small>Phone preview on a laptop</small>${layoutToggle}</div>`:''}<header class="top"><div class="logo"><i>₵</i><span>${esc(S.org.name)}</span></div>${unitSel}<button class="iconbtn" data-act="sheet" data-t="more" aria-label="More">☰</button></header>${content}</main></div>`;
  const tabs=MAIN();
  tabsEl.innerHTML=`<div style="--n:${tabs.length}">${tabs.map(navBtn).join('')}</div>`;
  layer.innerHTML=S.sheet?`<div class="sheetbg" data-act="bg">${sheetHTML()}</div>`:'';
}
function toast(msg){ const t=document.createElement('div'); t.className='toast'; t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(),3200); }
const val=id=>($(id)||{}).value||'';
const chk=id=>!!($(id)||{}).checked;
const top0=()=>window.scrollTo(0,0);
const amountOf=id=>{ const v=parseFloat(val(id)); return v>0?Math.round(v*100)/100:0; };

/* ===================== Actions ===================== */
document.addEventListener('click', async e=>{
  const el=e.target.closest('[data-act]'); if(!el) return;
  const a=el.dataset.act, id=el.dataset.id;
  if(a==='bg'&&e.target!==el) return;
  switch(a){
    /* auth */
    case 'authmode': S.authMode=id; S.authMsg=''; break;
    case 'signin': { const {error}=await sb.auth.signInWithPassword({email:val('ae').trim(),password:val('ap')}); if(error){ S.authMsg=error.message==='Invalid login credentials'?'Wrong email or password.':error.message; } break; }
    case 'signup': { const em=val('ae').trim(), pw=val('ap'); if(pw.length<8){ S.authMsg='Use a password of at least 8 characters.'; break; }
      const {data,error}=await sb.auth.signUp({email:em,password:pw,options:{emailRedirectTo:appLink()}});
      S.authMsg = error ? error.message : (data.session ? '' : 'Check your email and tap the confirmation link, then come back and sign in.'); break; }
    case 'reset': { const {error}=await sb.auth.resetPasswordForEmail(val('ae').trim(),{redirectTo:appLink()}); S.authMsg=error?error.message:'Reset link sent. Check your email.'; break; }
    case 'setpw': { const pw=val('np'); if(pw.length<8){ S.authMsg='Use at least 8 characters.'; break; } const {error}=await sb.auth.updateUser({password:pw}); if(error){ S.authMsg=error.message; break; } S.recovery=false; toast('Password changed.'); break; }
    case 'signout': await sb.auth.signOut(); return;
    /* setup */
    case 'stype': SETUP.name=val('sname'); SETUP.main=val('smain'); SETUP.subs=val('ssubs'); SETUP.cur=val('scur')||SETUP.cur; SETUP.kind=id;
      if(id==='org'&&SETUP.main==='Teshie No. 1 Station'){ SETUP.main='Head Office'; SETUP.subs='Finance\nWelfare\nEvents'; } break;
    case 'createorg': { if(S.busy) return; const kind=SETUP.kind, name=val('sname').trim(), main=val('smain').trim(); if(!name||!main){ toast('Enter the names first.'); return; }
      S.busy=true; render();
      try{ const subs=val('ssubs').split('\n').map(s=>s.trim()).filter(Boolean);
        await must(sb.rpc('create_org',{p_name:name,p_kind:kind,p_currency:val('scur'),p_features:{dayborn:kind==='church'&&chk('sdb'),pledges:chk('spl')},p_main_name:main,p_main_level:TERMS[kind].top,p_sub_level:TERMS[kind].sub,p_subs:subs}));
        await loadOrgs(); await loadAll(); S.tab='structure'; toast('Your finance book is ready. Set each unit’s starting balance.'); }
      catch(err){ toast(errText(err)); } finally{ S.busy=false; } break; }
    /* navigation */
    case 'layout': S.forcePhone=id==='phone'; break;
    case 'tab': S.tab=id; S.member=S.payee=S.camp=null; S.group=null; S.sheet=null; S.service=S.program=null; top0(); break;
    case 'view': S.view=id; top0(); break;
    case 'member': S.member=id||null; top0(); break;
    case 'gomember': S.tab='members'; S.member=id; S.group=null; top0(); break;
    case 'group': { const i=+el.dataset.i; S.group=i>=0?i:null; top0(); break; }
    case 'camp': S.camp=id||null; top0(); break;
    case 'payee': S.payee=id||null; top0(); break;
    case 'skind': S.spendKind=id; break;
    case 'showall': S.showAll=true; break;
    case 'owing': S.showOwing=true; break;
    case 'hshow': S.showHigher=true; break;
    case 'hcancel': S.showHigher=false; break;
    case 'bedit': S.editB=id; break;
    case 'sheet': S.sheet={t:el.dataset.t,id,member:el.dataset.member,fund:el.dataset.fund,service:el.dataset.service,program:el.dataset.program}; if(el.dataset.t==='dayentry') S.sunday=DAYS.map(()=> ''); break;
    /* services & programs */
    case 'svctab': S.svcTab=id; break;
    case 'opensvc': S.tab='services'; S.service=id; S.program=null; S.svcDraft={}; S.sheet=null; top0(); break;
    case 'closesvc': { const s=svcById(S.service); S.service=null; S.svcDraft={}; if(s?.program_id&&S.lastProg===s.program_id){ S.program=s.program_id; } top0(); break; }
    case 'openprog': S.tab='services'; S.svcTab='programs'; S.program=id; S.lastProg=id; S.service=null; S.sheet=null; top0(); break;
    case 'closeprog': S.program=null; S.lastProg=null; top0(); break;
    case 'createservice': case 'updservice': { const d=val('svd'); let k=val('svk'), t=val('svt').trim(); if(!d){ toast('Choose the date.'); return; }
      if(k==='__other'){ if(!t){ toast('Type the service type in the Name box.'); return; } k=t; t=''; }
      if(a==='updservice') return act(()=>must(sb.from('services').update({service_date:d,kind:k,title:t||null,program_id:val('svp')||null}).eq('id',id)),'Service updated.');
      let row; return act(async()=>{ row=await must(sb.from('services').insert({unit_id:val('svu'),service_date:d,kind:k,title:t||null,program_id:val('svp')||null}).select().single()); },'Service created. Now record its money.').then(()=>{ if(row){ S.tab='services'; S.service=row.id; S.svcDraft={}; render(); } }); }
    case 'saveprog': { const n=val('prn').trim(), s=val('prs'), e2=val('pre'); if(!n||!s||!e2){ toast('Enter the name and both dates.'); return; } if(e2<s){ toast('The end date is before the start date.'); return; }
      const g=k=>{ const x=$(k); return x?(x.value.trim()||null):undefined; }, b=val('prb');
      const rec={name:n,starts_on:s,ends_on:e2,budget:b===''?null:Math.max(0,parseFloat(b)||0),notes:g('prno')};
      [['theme','prt'],['speakers','prsp'],['team','prtm'],['venue','prv']].forEach(([f,i])=>{ const v=g(i); if(v!==undefined) rec[f]=v; });
      if(id) return act(()=>must(sb.from('programs').update(rec).eq('id',id)),'Program saved.');
      let row; return act(async()=>{ row=await must(sb.from('programs').insert({...rec,unit_id:val('pru')}).select().single()); },`${n} created.`).then(()=>{ if(row){ S.tab='services'; S.svcTab='programs'; S.program=row.id; S.lastProg=row.id; render(); } }); }
    case 'savesvc': { const s=svcById(id); if(!s) return; const d=S.svcDraft, rows=[];
      svcItems().filter(it=>it!=='Day Born').forEach(it=>{ const v=Math.round((parseFloat(d[it])||0)*100)/100; if(v>0) rows.push({unit_id:s.unit_id,txn_date:s.service_date,category:it,amount:v,service_id:s.id,program_id:s.program_id,method:'Cash',campaign_id:it==='Fundraising'?(d.__camp||null):null,note:s.title||s.kind}); });
      const oa=Math.round((parseFloat(d.__otherAmt)||0)*100)/100, oc=(d.__otherCat||'').trim();
      if(oa>0){ if(!oc){ toast('Type what the “Other” amount is for.'); return; } rows.push({unit_id:s.unit_id,txn_date:s.service_date,category:oc,amount:oa,service_id:s.id,program_id:s.program_id,method:'Cash',note:s.title||s.kind}); }
      const c1=val('sc1').trim(), c2=val('sc2').trim(), cChanged=c1!==(s.counter1||'')||c2!==(s.counter2||'');
      if(!rows.length&&!cChanged){ toast('Enter at least one amount.'); return; }
      return act(async()=>{ if(rows.length) await must(sb.from('transactions').insert(rows)); if(cChanged) await must(sb.from('services').update({counter1:c1||null,counter2:c2||null}).eq('id',s.id)); S.svcDraft={}; }, rows.length?`Saved ${rows.length} item${rows.length>1?'s':''} · ${fmt(rows.reduce((a,r)=>a+r.amount,0))}.`:'Saved.'); }
    case 'savephoto': { const P=S.photo, sv=svcById(P?.service); if(!P||!sv) return; const R=P.result||{};
      const items=(R.items||[]).filter(x=>x&&x.amount>0), exps=(R.expenses||[]).filter(x=>x&&x.amount>0), rows=[], exRows=[];
      items.forEach((_,i)=>{ if(!chk('phk'+i)) return; const c=val('phc'+i).trim(), v=Math.round((parseFloat(val('pha'+i))||0)*100)/100; if(c&&v>0) rows.push({unit_id:sv.unit_id,txn_date:sv.service_date,category:c,amount:v,service_id:sv.id,program_id:sv.program_id,method:'Cash',note:(sv.title||sv.kind)+' (from photo)'}); });
      exps.forEach((x,i)=>{ if(!chk('pxk'+i)) return; const v=Math.round((parseFloat(val('pxa'+i))||0)*100)/100, pp=val('pxp'+i).trim()||'Expense', to=val('pxt'+i).trim()||pp; if(v>0) exRows.push({unit_id:sv.unit_id,paid_to:to,purpose:pp,amount:v,exp_date:sv.service_date,fund:'General fund',service_id:sv.id,program_id:sv.program_id,note:'From photo'}); });
      const dbAm=DAYS.map((_,i)=>{ const el=$('phd'+i); return el?Math.round((parseFloat(el.value)||0)*100)/100:0; }), dbTot=dbAm.reduce((a,b)=>a+b,0);
      if(!rows.length&&!exRows.length&&!dbTot){ toast('Nothing ticked to save.'); return; }
      return act(async()=>{
        if(rows.length) await must(sb.from('transactions').insert(rows));
        if(dbTot>0) await must(sb.rpc('save_dayborn',{p_unit:sv.unit_id,p_sunday:sv.service_date,p_amounts:dbAm,p_c1:(R.counters||[])[0]||'',p_c2:(R.counters||[])[1]||'',p_service:sv.id}));
        if(exRows.length) await must(sb.from('expenses').insert(exRows));
        if(P.url) URL.revokeObjectURL(P.url); S.photo=null;
      }, `Saved from photo: ${rows.length} income item${rows.length===1?'':'s'}${dbTot?', Day Born':''}${exRows.length?`, ${exRows.length} expense${exRows.length>1?'s':''}`:''}.`); }
    case 'sharesvc': { const s=svcById(id), tx=svcTx(id), ex=svcEx(id).filter(counted), by={}; tx.forEach(t=>by[t.category]=(by[t.category]||0)+num(t.amount));
      const text=`${S.org.name} — ${s.title||s.kind}, ${dLong(s.service_date)}\n`+Object.entries(by).map(([k,v])=>`${k}: ${fmt(v)}`).join('\n')+`\nTotal income: ${fmt(sumAmt(tx))}\nExpenses: ${fmt(sumAmt(ex))}\nBalance: ${fmt(sumAmt(tx)-sumAmt(ex))}`;
      window.open('https://wa.me/?text='+encodeURIComponent(text),'_blank','noopener'); return; }
    case 'shareprog': { const p=progById(id), tx=progTx(p), ex=progEx(p).filter(counted);
      const text=`${S.org.name} — ${p.name} (${dLong(p.starts_on)} – ${dLong(p.ends_on)})\nIncome: ${fmt(sumAmt(tx))}\nExpenses: ${fmt(sumAmt(ex))}\nBalance: ${fmt(sumAmt(tx)-sumAmt(ex))}`;
      window.open('https://wa.me/?text='+encodeURIComponent(text),'_blank','noopener'); return; }
    case 'saveitems': { const items=[...document.querySelectorAll('input[name=svi]:checked')].map(x=>x.value), extra=val('sviadd').split(',').map(s=>s.trim()).filter(Boolean);
      const all=[...new Set([...items,...extra])]; if(!all.length){ toast('Keep at least one item.'); return; }
      const kinds=val('svkinds').split('\n').map(s=>s.trim()).filter(Boolean);
      const pf={}; ['theme','speakers','team','venue'].forEach(k=>pf[k]=chk('pf_'+k));
      return act(()=>must(sb.from('orgs').update({features:{...(S.org.features||{}),service_items:all,service_kinds:kinds.length?kinds:svcKinds(),program_fields:pf}}).eq('id',S.org.id)),'Saved.'); }
    case 'close': case 'bg': S.sheet=null; if(S.photo&&!S.photo.loading){ if(S.photo.url) URL.revokeObjectURL(S.photo.url); S.photo=null; } break;
    case 'copy': try{ await navigator.clipboard.writeText(id); toast('Link copied.'); }catch(err){ toast('Select the link and copy it.'); } return;
    case 'print': window.print(); return;
    /* money */
    case 'saveincome': { const amt=amountOf('ia'), cat=val('it').trim(), unit=val('iu'); if(!amt||!cat||!unit){ toast('Enter the type and an amount above 0.'); return; }
      const sv=svcById(S.sheet?.service), prog=sv?sv.program_id:(val('ip')||null);
      let saved; return act(async()=>{ saved=await must(sb.from('transactions').insert({unit_id:unit,category:cat,amount:amt,member_id:val('im')||null,txn_date:val('id')||todayISO(),method:val('ipm'),note:val('in')||null,service_id:sv?.id||null,program_id:prog}).select().single()); }, 'Saved.').then(()=>{ if(saved){ S.sheet={t:'txn',id:saved.id}; render(); } }); }
    case 'saveexp': { const amt=amountOf('xa'), to=val('xto').trim(), what=val('xline').trim(); if(!amt||!to||!what){ toast('Enter who was paid, what for, and an amount.'); return; }
      const sv=svcById(S.sheet?.service), prog=sv?sv.program_id:(val('xp')||null);
      return act(()=>must(sb.from('expenses').insert({unit_id:val('xu'),paid_to:to,purpose:what,amount:amt,exp_date:val('xd')||todayISO(),fund:val('xf')||'General fund',budget_id:val('xb')||null,note:val('xn')||null,service_id:sv?.id||null,program_id:prog})),'Expense saved. Waiting for approval.'); }
    case 'savepay': { const l=S.lines.find(x=>x.id===id), p=S.payees.find(x=>x.id===l.payee_id), amt=amountOf('pa'); if(!amt){ toast('Enter an amount above 0.'); return; }
      return act(()=>must(sb.from('expenses').insert({unit_id:p.unit_id,payee_id:p.id,line_id:l.id,paid_to:p.name,purpose:l.name,amount:amt,exp_date:val('pd')||todayISO(),fund:val('pf')||'General fund',budget_id:l.budget_id,note:val('pn')||null})),`${l.name} recorded. Waiting for approval.`); }
    case 'approve': return act(()=>must(sb.from('expenses').update({status:'approved'}).eq('id',id)),'Approved. Now send the confirmation link.').then(()=>{ S.sheet={t:'expense',id}; render(); });
    case 'reject': return act(()=>must(sb.from('expenses').update({status:'rejected'}).eq('id',id)),'Rejected.');
    case 'markconfirmed': return act(()=>must(sb.from('expenses').update({status:'confirmed'}).eq('id',id)),'Marked as confirmed.');
    case 'voidexp': { const r=val('vreason').trim(); if(!r){ toast('Write the reason first.'); return; } return act(()=>must(sb.from('expenses').update({voided:true,void_reason:r}).eq('id',id)),'Expense voided.'); }
    case 'voidtx': { const r=val('vreason').trim(); if(!r){ toast('Write the reason first.'); return; } return act(()=>must(sb.from('transactions').update({voided:true,void_reason:r}).eq('id',id)),'Entry voided.'); }
    case 'savesunday': { const amts=DAYS.map((_,i)=>Math.round((parseFloat(S.sunday[i])||0)*100)/100), tot=amts.reduce((a,b)=>a+b,0), sun=val('dsun');
      if(!tot){ toast('Enter at least one group amount.'); return; } if(!sun){ toast('Choose the Sunday.'); return; }
      const sv=svcById(id), unit=sv?sv.unit_id:mainUnit().id;
      return act(()=>must(sb.rpc('save_dayborn',{p_unit:unit,p_sunday:sun,p_amounts:amts,p_c1:val('c1'),p_c2:val('c2'),p_service:sv?.id||null})),`Saved Day Born ${fmt(tot)} for ${dLong(sun)}.`).then(()=>{ if(!sv){ S.tab='dayborn'; S.group=null; } render(); }); }
    case 'savepayee': { const n=val('pyn').trim(); if(!n){ toast('Type a name first.'); return; }
      let row; return act(async()=>{ row=await must(sb.from('payees').insert({unit_id:val('pyu'),kind:id,name:n,note:val('pynote')||null}).select().single()); },`${n} added. Now add their lines.`).then(()=>{ if(row){ S.payee=row.id; render(); } }); }
    case 'saveline': { const n=val('ln').trim(), amt=amountOf('la'); if(!n||!amt){ toast('Enter a name and an amount.'); return; }
      return act(()=>must(sb.from('payee_lines').insert({payee_id:id,name:n,amount:amt,frequency:val('lf'),budget_id:val('lb')||null})),'Line added.'); }
    case 'bsave': { const v=parseFloat(val('bedit')); if(!(v>=0)){ toast('Enter an amount.'); return; } S.editB=null; return act(()=>must(sb.from('budgets').update({amount:v}).eq('id',id)),'Budget updated.'); }
    case 'badd': { const n=val('bname').trim(), v=amountOf('bamt'); if(!n||!v){ toast('Enter a name and an amount above 0.'); return; }
      return act(()=>must(sb.from('budgets').insert({unit_id:val('bunit'),year:YEAR,name:n,amount:v})),`“${n}” added to the budget.`); }
    case 'addtarget': { const v=amountOf('tamt'); if(!v){ toast('Enter a target amount.'); return; }
      return act(()=>must(sb.from('targets').insert({unit_id:val('tunit'),year:YEAR,category:val('tcat'),amount:v})),'Target added.'); }
    case 'savecamp': { const n=val('cn').trim(), v=amountOf('ct'); if(!n||!v){ toast('Enter a name and a target.'); return; }
      return act(()=>must(sb.from('campaigns').insert({unit_id:val('cu'),name:n,target:v,ends_on:val('ce')||null})),`${n} started.`); }
    case 'savepledge': { const v=amountOf('pla'), m=val('plm'); if(!v||!m){ toast('Choose a member and an amount.'); return; }
      return act(()=>must(sb.from('pledges').insert({campaign_id:id,member_id:m,amount:v})),'Pledge saved.'); }
    case 'savepledgepay': { const v=amountOf('ppa'), c=S.camps.find(x=>x.id===id); if(!v){ toast('Enter an amount.'); return; }
      return act(()=>must(sb.from('transactions').insert({unit_id:c.unit_id,category:'Fundraising',amount:v,member_id:val('ppm')||null,campaign_id:c.id,method:val('ppw'),note:c.name})),'Payment saved.'); }
    /* members */
    case 'addmember': { const n=val('mn').trim(), us=[...document.querySelectorAll('input[name=mu]:checked')].map(x=>x.value); if(!n){ toast('Type the name first.'); return; } if(!us.length){ toast('Tick at least one unit.'); return; }
      return act(()=>must(sb.rpc('add_member',{p_org:S.org.id,p_name:n,p_phone:val('mp'),p_gender:val('mg'),p_day:val('md'),p_units:us})),`${n} added.`).then(()=>{ S.q=n; render(); }); }
    case 'updmember': { const n=val('mn').trim(); if(!n){ toast('Type the name first.'); return; }
      return act(()=>must(sb.from('members').update({full_name:n,phone:val('mp')||null,gender:val('mg')||null,day_born:val('md')||null,active:chk('mact')}).eq('id',id)),'Saved.'); }
    case 'sharestatement': { const m=S.members.find(x=>x.id===id), mt=liveTx().filter(t=>t.member_id===id&&t.txn_date.startsWith(String(YEAR)));
      const by={}; mt.forEach(t=>by[t.category]=(by[t.category]||0)+num(t.amount));
      const text=`${S.org.name} — ${YEAR} giving statement for ${m.full_name}\n`+(Object.entries(by).map(([k,v])=>`${k}: ${fmt(v)}`).join('\n')||'No payments yet')+`\nThank you and God bless.`;
      window.open('https://wa.me/?text='+encodeURIComponent(text),'_blank','noopener'); return; }
    /* structure & settings */
    case 'addunit': { const n=val('newunit').trim(); if(!n){ toast('Type a name first.'); return; } const mu=mainUnit();
      return act(()=>must(sb.from('units').insert({org_id:S.org.id,parent_id:mu.id,name:n,level:C().sub})),`${n} added.`); }
    case 'hadd': { const n=val('hname').trim(); if(!n){ toast('Type a name first.'); return; } S.showHigher=false;
      return act(()=>must(sb.rpc('add_higher_level',{p_org:S.org.id,p_name:n,p_level:val('hlevel')})),`${n} added above.`); }
    case 'saveunit': { const n=val('un').trim(), b=parseFloat(val('ub'))||0; if(!n){ toast('Name cannot be empty.'); return; }
      return act(()=>must(sb.from('units').update({name:n,opening_balance:b}).eq('id',id)),'Saved.'); }
    case 'savesettings': return act(()=>must(sb.from('orgs').update({name:val('setname').trim()||S.org.name,currency:val('setcur'),kind:val('setkind')}).eq('id',S.org.id)),'Settings saved.');
    case 'saveinvite': case 'saveaccess': { const acc=readAccess(); if(!acc) return;
      if(a==='saveaccess') return act(()=>must(sb.from('org_users').update(acc).eq('id',id)),'Access updated. They see the change next time they open the app.');
      const em=val('ive').trim().toLowerCase(); if(!/^\S+@\S+\.\S+$/.test(em)){ toast('Enter a valid email.'); return; }
      let row; return act(async()=>{ row=await must(sb.from('invites').insert({org_id:S.org.id,email:em,display_name:val('ivn').trim()||null,...acc}).select().single()); },'Invite created.').then(()=>{ if(row){ S.sheet={t:'invited',id:row.id}; render(); } }); }
    case 'cancelinvite': return act(()=>must(sb.from('invites').delete().eq('id',id)),'Invite cancelled.');
    case 'removeuser': return act(()=>must(sb.from('org_users').delete().eq('id',id)),'Removed.');
    case 'csv': exportCSV(); return;
    case 'sharereport': { const r=reportNumbers(); window.open('https://wa.me/?text='+encodeURIComponent(`${S.org.name} — ${scopeLabel()}\nStatement for ${r.label}\nOpening: ${fmt(r.open)}\nIncome: ${fmt(r.inc)}\nExpenses: ${fmt(r.out)}\nClosing: ${fmt(r.close)}`),'_blank','noopener'); return; }
  }
  render();
});
function reportNumbers(){ const sc=scope(), mk=S.reportMonth, [yy,mm]=mk.split('-').map(Number), next=new Date(yy,mm,1).toLocaleDateString('en-CA');
  const inc=liveTx().filter(x=>inScope(x.unit_id)&&ym(x.txn_date)===mk).reduce((s,x)=>s+num(x.amount),0), out=S.expenses.filter(x=>inScope(x.unit_id)&&counted(x)&&ym(x.exp_date)===mk).reduce((s,x)=>s+num(x.amount),0);
  return {label:`${MONTHS[mm-1]} ${yy}`,open:balanceBefore(sc,mk+'-01'),close:balanceBefore(sc,next),inc,out}; }
function exportCSV(){
  const mk=S.reportMonth, q=v=>`"${String(v??'').replace(/"/g,'""')}"`;
  const rows=[['Kind','Date','Unit','Type / Purpose','Member / Paid to','Amount','Status','Receipt','Note']];
  liveTx().filter(x=>inScope(x.unit_id)&&ym(x.txn_date)===mk).forEach(t=>rows.push(['Income',t.txn_date,uName(t.unit_id),t.category,memberName(t.member_id),num(t.amount),'',t.receipt_no,t.note||'']));
  S.expenses.filter(x=>inScope(x.unit_id)&&ym(x.exp_date)===mk).forEach(e=>rows.push(['Expense',e.exp_date,uName(e.unit_id),e.purpose,e.paid_to,-num(e.amount),e.voided?'voided':e.status,'EXP-'+e.receipt_no,e.note||'']));
  const blob=new Blob(['﻿'+rows.map(r=>r.map(q).join(',')).join('\r\n')],{type:'text/csv'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`SikaBook-${mk}.csv`; document.body.appendChild(a); a.click(); a.remove();
}
document.addEventListener('input', e=>{
  if(e.target.id==='msearch'){ S.q=e.target.value; const el=$('mlist'); if(el) el.innerHTML=memberList(membersInScope()); }
  if(e.target.dataset.svc!==undefined){ S.svcDraft[e.target.dataset.svc]=e.target.value; const el=$('svctotal'); if(el){ const d=S.svcDraft; el.textContent=fmt(Object.entries(d).filter(([k])=>!k.startsWith('__')).reduce((a,[,v])=>a+(parseFloat(v)||0),0)+(parseFloat(d.__otherAmt)||0)); } }
  if(e.target.dataset.day!==undefined){ S.sunday[+e.target.dataset.day]=e.target.value; const el=$('stotal'); if(el) el.textContent=fmt(S.sunday.reduce((s,v)=>s+(parseFloat(v)||0),0)); }
});
document.addEventListener('change', async e=>{
  if(e.target.id==='unitsel'){ S.view=e.target.value; S.member=S.payee=S.camp=null; S.group=null; render(); }
  if(e.target.id==='svccamp'){ S.svcDraft.__camp=e.target.value; }
  if(e.target.id==='photoin'&&e.target.files&&e.target.files[0]){ readPhoto(e.target.files[0], e.target.dataset.service); e.target.value=''; }
  if(e.target.id==='rmonth'){ S.reportMonth=e.target.value||S.reportMonth; render(); }
  if(e.target.id==='orgsel'){ try{ localStorage.setItem('sikabook.org',e.target.value); }catch(err){} await loadOrgs(); S.view='all'; await refresh(); }
  if(e.target.dataset.feat){ const f={...(S.org.features||{}),[e.target.dataset.feat]:e.target.checked}; act(()=>must(sb.from('orgs').update({features:f}).eq('id',S.org.id)),'Saved.'); }
});
const tip=$('tip');
document.addEventListener('pointerover', e=>{ const t=e.target.closest&&e.target.closest('[data-tip]'); if(!t){ tip.hidden=true; return; } const r=t.getBoundingClientRect(); tip.textContent=t.dataset.tip; tip.style.left=Math.min(window.innerWidth-90,Math.max(90,r.left+r.width/2))+'px'; tip.style.top=(r.top+r.height*0.2)+'px'; tip.hidden=false; });
document.addEventListener('scroll', ()=>{ tip.hidden=true; }, {passive:true});
let lastDesk=isDesk(); window.addEventListener('resize', ()=>{ if(isDesk()!==lastDesk){ lastDesk=isDesk(); render(); } });

/* ===================== Photo reading ===================== */
async function shrinkImage(file, max=1800){
  const url=URL.createObjectURL(file);
  const img=await new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=url; });
  const k=Math.min(1, max/Math.max(img.naturalWidth,img.naturalHeight)), c=document.createElement('canvas');
  c.width=Math.round(img.naturalWidth*k); c.height=Math.round(img.naturalHeight*k);
  c.getContext('2d').drawImage(img,0,0,c.width,c.height);
  const data=c.toDataURL('image/jpeg',0.85).split(',')[1];
  return {url,data};
}
async function readPhoto(file, serviceId){
  S.photo={service:serviceId,loading:true}; S.sheet={t:'photo'}; render();
  try{
    const {url,data}=await shrinkImage(file); S.photo.url=url; render();
    const {data:res,error}=await sb.functions.invoke('read-sheet',{body:{image:data,mime:'image/jpeg',items:svcItems().filter(x=>x!=='Day Born')}});
    if(error){ let msg='The photo reader is not available right now.'; try{ const b=await error.context.json(); if(b&&b.error) msg=b.error; }catch(_){} throw new Error(msg); }
    if(!res||!res.result) throw new Error((res&&res.error)||'Could not read that photo.');
    S.photo={...S.photo,loading:false,result:res.result};
  }catch(err){ S.photo={...S.photo,loading:false,error:err.message||String(err)}; }
  if(S.sheet&&S.sheet.t==='photo') render();
}

/* ===================== Recipient confirmation page (no sign-in) ===================== */
async function confirmPage(token){
  const root=$('root');
  root.innerHTML='<div class="loading">Loading…</div>';
  const {data,error}=await sb.rpc('get_receipt',{p_token:token});
  const r=data&&data[0];
  if(error||!r){ root.innerHTML=`<div class="confirm-page"><div class="logo"><i>₵</i><span>SikaBook</span></div><div class="card"><h3>Link not found</h3><span class="muted">This confirmation link is not valid. Please ask the church office for a new one.</span></div></div>`; return; }
  const sym=(CURRENCIES.find(c=>c[0]===r.currency)||CURRENCIES[0])[1], amt=`${sym} ${num(r.amount).toLocaleString('en-US',{maximumFractionDigits:2})}`;
  const done=r.status==='confirmed';
  root.innerHTML=`<div class="confirm-page"><div class="logo"><i>₵</i><span>${esc(r.org_name)}</span></div>
    <div class="card"><span class="muted">${esc(r.unit_name)} · ${dLong(r.exp_date)}</span><h2 style="font-size:22px">${esc(r.paid_to)}</h2>
      <div class="bigamt num">${esc(amt)}</div><span>for <b>${esc(r.purpose)}</b></span>
      ${done?'<span class="chip good" style="align-self:flex-start">✓ You already confirmed this. Thank you.</span>'
        :r.status==='approved'?`<span class="muted">Please confirm only if you have received this money.</span><button class="btn full" id="cfm" style="padding:14px">Yes, I received it</button>`
        :'<span class="muted">This payment is not ready to confirm yet.</span>'}
    </div><span class="muted" style="text-align:center">Powered by SikaBook</span></div>`;
  const b=$('cfm'); if(b) b.onclick=async()=>{ b.disabled=true; b.textContent='Confirming…'; const {data:res}=await sb.rpc('confirm_receipt',{p_token:token}); if(res==='ok'||res==='already'){ b.outerHTML='<span class="chip good" style="align-self:flex-start">✓ Thank you. Your confirmation has been sent.</span>'; } else { b.disabled=false; b.textContent='Yes, I received it'; toast('Could not confirm. Try again.'); } };
}

/* ===================== Boot ===================== */
async function boot(){
  const token=new URLSearchParams(location.search).get('r');
  if(token){ render(); return confirmPage(token); }
  sb.auth.onAuthStateChange(async (event, session)=>{
    if(event==='PASSWORD_RECOVERY'){ S.recovery=true; S.user=session?.user||null; S.loading=false; render(); return; }
    if(event==='SIGNED_IN'||event==='INITIAL_SESSION'||event==='SIGNED_OUT'||event==='USER_UPDATED'){
      const newUser=session?.user||null, changed=(newUser?.id)!==(S.user?.id);
      S.session=session; S.user=newUser;
      if(!S.user){ S.org=null; S.me=null; S.loading=false; render(); return; }
      if(changed||event==='INITIAL_SESSION'){ S.loading=true; render(); setTimeout(async()=>{ try{ await loadOrgs(); await loadAll(); }catch(err){ toast(errText(err)); } S.loading=false; S.authMsg=''; render(); },0); }
      else render();
    }
  });
}
if('serviceWorker' in navigator && location.protocol==='https:'){ navigator.serviceWorker.register('sw.js').catch(()=>{}); }
boot();
