const SHEET_PROJECTS   = "Projects";
const SHEET_MEMBERS    = "Members";
const SHEET_EXPENSES   = "Expenses";
const SHEET_FXRATES    = "FxRates";
const SHEET_CATEGORIES = "Categories";
const SHEET_PAYMENTS   = "Payments";
const SHEET_RULES      = "Rules";

function doGet(e)  { return route(e); }
function doPost(e) { return route(e); }

function route(e) {
  try {
    const p = e.parameter;
    const handlers = {
      getProject:      () => getProject(p.projectId),
      createProject:   () => createProject(p.name, p.currency),
      addMember:       () => addMember(p.projectId, p.name),
      addExpense:      () => addExpense(p),
      getExpenses:     () => getExpenses(p.projectId),
      getSettlement:   () => getSettlement(p.projectId),
      deleteExpense:   () => deleteExpense(p.expenseId, p.projectId),
      editExpense:     () => editExpense(p),
      setFxRate:       () => setFxRate(p.projectId, p.currency, p.rate),
      getFxRates:      () => getFxRates(p.projectId),
      getAllProjects:   () => getAllProjects(),
      addCategory:     () => addCategory(p.projectId, p.name),
      getCategories:   () => getCategories(p.projectId),
      mergeMembers:    () => mergeMembers(p.projectId, p.keepMemberId, p.mergeMemberId),
      renameProject:   () => renameProject(p.projectId, p.newName),
      updateProjectCurrency: () => updateProjectCurrency(p.projectId, p.currency),
      archiveProject:  () => archiveProject(p.projectId, p.archived),
      addPayment:      () => addPayment(p),
      getPayments:     () => getPayments(p.projectId),
      deletePayment:   () => deletePayment(p.paymentId, p.projectId),
      bulkMoveExpenses: () => bulkMoveExpenses(p.expenseIds, p.fromProjectId, p.toProjectId),
      getRules:        () => getRules(),
      upsertRule:      () => upsertRule(p),
      deleteRule:      () => deleteRule(p.ruleId),
    };
    if (!handlers[p.action]) return jsonp({ error: "Unknown action: " + p.action }, p.callback);
    return jsonp(handlers[p.action](), p.callback);
  } catch (err) {
    return jsonp({ error: err.message }, e && e.parameter && e.parameter.callback);
  }
}

function json(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
function jsonp(data, callback) { if (!callback) return json(data); return ContentService.createTextOutput(callback + "(" + JSON.stringify(data) + ")").setMimeType(ContentService.MimeType.JAVASCRIPT); }
function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet(name) { return ss().getSheetByName(name); }

function ensureSheets() {
  const needed = {
    [SHEET_PROJECTS]:   ["projectId","name","defaultCurrency","createdAt","archived"],
    [SHEET_MEMBERS]:    ["memberId","projectId","name","joinedAt"],
    [SHEET_EXPENSES]:   ["expenseId","projectId","itemName","amount","currency","payerId","payerName","splitBetween","category","notes","customSplits","expenseDate","logDate","createdAt"],
    [SHEET_FXRATES]:    ["projectId","currency","rate","updatedAt"],
    [SHEET_CATEGORIES]: ["categoryId","projectId","name","createdAt"],
    [SHEET_PAYMENTS]:   ["paymentId","projectId","fromId","fromName","toId","toName","amount","currency","note","createdAt"],
    [SHEET_RULES]:      ["ruleId","keyword","projectId","category","splitBetween","payerId","hitCount","lastUsed"],
  };
  const wb = ss();
  for (const [name, headers] of Object.entries(needed)) {
    let sh = wb.getSheetByName(name);
    if (!sh) {
      sh = wb.insertSheet(name);
      sh.appendRow(headers);
      sh.getRange(1,1,1,headers.length).setFontWeight("bold");
      sh.setFrozenRows(1);
    }
  }
}

function sheetData(name) {
  const sh = sheet(name);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues();
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map(r => { const obj = {}; headers.forEach((h,i) => { const key=String(h).trim(); obj[key] = r[i]; }); return obj; });
}

function slugify(name) { return name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").substring(0,30) || "project"; }

// ── CATEGORIES ───────────────────────────────────────────
function getCategories(projectId) {
  ensureSheets();
  return { categories: sheetData(SHEET_CATEGORIES).filter(c => c.projectId.toLowerCase() === projectId.toLowerCase()).map(c => ({ categoryId: c.categoryId, name: c.name })) };
}

function addCategory(projectId, name) {
  ensureSheets();
  if (!projectId || !name) throw new Error("Required");
  name = name.trim();
  const existing = sheetData(SHEET_CATEGORIES).filter(c => c.projectId.toLowerCase() === projectId.toLowerCase()).find(c => c.name.toLowerCase() === name.toLowerCase());
  if (existing) return { categoryId: existing.categoryId, name: existing.name, existing: true };
  const categoryId = Utilities.getUuid().replace(/-/g,"").substring(0,12);
  sheet(SHEET_CATEGORIES).appendRow([categoryId, projectId, name, new Date().toISOString()]);
  return { categoryId, name };
}

// ── PROJECTS ─────────────────────────────────────────────
function getAllProjects() {
  ensureSheets();
  const projects = sheetData(SHEET_PROJECTS);
  const members  = sheetData(SHEET_MEMBERS);
  return { projects: projects.map(p => ({
    projectId: p.projectId, name: p.name, defaultCurrency: p.defaultCurrency,
    createdAt: p.createdAt, archived: p.archived === true || p.archived === "true",
    members: members.filter(m => m.projectId === p.projectId).map(m => ({ memberId: m.memberId, name: m.name })),
  }))};
}

function getProject(projectId) {
  ensureSheets();
  const project = sheetData(SHEET_PROJECTS).find(p => p.projectId.toLowerCase() === projectId.toLowerCase());
  if (!project) return { error: "Project not found" };
  const members    = sheetData(SHEET_MEMBERS).filter(m => m.projectId.toLowerCase() === projectId.toLowerCase());
  const fxRates    = getFxRates(projectId).fxRates;
  const categories = getCategories(projectId).categories;
  return { project, members, fxRates, categories };
}

function createProject(name, currency) {
  ensureSheets();
  if (!name) throw new Error("Project name required");
  const base = slugify(name);
  const existing = sheetData(SHEET_PROJECTS).map(p => p.projectId);
  let projectId = base;
  if (existing.includes(projectId)) { let i=2; while(existing.includes(base+"-"+String(i).padStart(2,"0"))) i++; projectId=base+"-"+String(i).padStart(2,"0"); }
  sheet(SHEET_PROJECTS).appendRow([projectId, name, (currency||"USD").toUpperCase(), new Date().toISOString(), false]);
  return { projectId, name };
}

function renameProject(projectId, newName) {
  ensureSheets();
  if (!projectId || !newName) throw new Error("Required");
  const sh = sheet(SHEET_PROJECTS), rows = sh.getDataRange().getValues();
  for (let i=1; i<rows.length; i++) { if (rows[i][0].toLowerCase()===projectId.toLowerCase()) { sh.getRange(i+1,2).setValue(newName.trim()); return { renamed:true, name:newName.trim() }; } }
  return { error: "Project not found" };
}

function updateProjectCurrency(projectId, currency) {
  ensureSheets();
  if (!projectId || !currency) throw new Error("Required");
  currency = currency.toUpperCase();
  const sh = sheet(SHEET_PROJECTS), rows = sh.getDataRange().getValues(), headers = rows[0];
  const ccyCol = headers.indexOf("defaultCurrency") + 1;
  if (!ccyCol) throw new Error("defaultCurrency column not found");
  for (let i=1; i<rows.length; i++) {
    if (rows[i][0].toLowerCase()===projectId.toLowerCase()) {
      sh.getRange(i+1, ccyCol).setValue(currency);
      return { updated: true, currency };
    }
  }
  return { error: "Project not found" };
}

function archiveProject(projectId, archived) {
  ensureSheets();
  const sh = sheet(SHEET_PROJECTS), rows = sh.getDataRange().getValues();
  const headers = rows[0];
  let archCol = headers.indexOf("archived") + 1;
  if (archCol === 0) { sh.getRange(1, headers.length+1).setValue("archived"); archCol = headers.length+1; }
  for (let i=1; i<rows.length; i++) {
    if (rows[i][0].toLowerCase()===projectId.toLowerCase()) {
      sh.getRange(i+1, archCol).setValue(archived==="true"||archived===true);
      return { archived: archived==="true"||archived===true };
    }
  }
  return { error: "Project not found" };
}

// ── MEMBERS ──────────────────────────────────────────────
function addMember(projectId, name) {
  ensureSheets();
  if (!projectId || !name) throw new Error("Required");
  const existing = sheetData(SHEET_MEMBERS).filter(m => m.projectId.toLowerCase()===projectId.toLowerCase()).find(m => m.name.toLowerCase()===name.toLowerCase());
  if (existing) return { memberId: existing.memberId, name: existing.name, existing: true };
  const memberId = Utilities.getUuid().replace(/-/g,"").substring(0,12);
  sheet(SHEET_MEMBERS).appendRow([memberId, projectId, name, new Date().toISOString()]);
  return { memberId, name };
}

function mergeMembers(projectId, keepMemberId, mergeMemberId) {
  ensureSheets();
  const expSh=sheet(SHEET_EXPENSES),expRows=expSh.getDataRange().getValues(),expHeaders=expRows[0];
  const splitIdx=expHeaders.indexOf("splitBetween")+1,payerIdIdx=expHeaders.indexOf("payerId")+1,payerNmIdx=expHeaders.indexOf("payerName")+1;
  const keepMember=sheetData(SHEET_MEMBERS).find(m=>m.memberId===keepMemberId);
  for (let i=1;i<expRows.length;i++) {
    if (expRows[i][1].toLowerCase()!==projectId.toLowerCase()) continue;
    const parts=String(expRows[i][splitIdx-1]).split(",");
    if (parts.includes(mergeMemberId)) { expSh.getRange(i+1,splitIdx).setValue([...new Set(parts.map(p=>p===mergeMemberId?keepMemberId:p))].join(",")); }
    if (expRows[i][payerIdIdx-1]===mergeMemberId) { expSh.getRange(i+1,payerIdIdx).setValue(keepMemberId); if(keepMember) expSh.getRange(i+1,payerNmIdx).setValue(keepMember.name); }
  }
  const memSh=sheet(SHEET_MEMBERS),memRows=memSh.getDataRange().getValues();
  for (let i=1;i<memRows.length;i++) { if(memRows[i][0]===mergeMemberId&&memRows[i][1].toLowerCase()===projectId.toLowerCase()){memSh.deleteRow(i+1);return{merged:true};} }
  return { merged: true };
}

// ── FX RATES ─────────────────────────────────────────────
function getFxRates(projectId) {
  const rates = sheetData(SHEET_FXRATES).filter(r=>r.projectId.toLowerCase()===projectId.toLowerCase()).reduce((acc,r)=>{acc[r.currency]=parseFloat(r.rate);return acc;},{});
  return { fxRates: rates };
}

function setFxRate(projectId, currency, rate) {
  ensureSheets();
  if (!projectId||!currency||!rate) throw new Error("Required");
  currency=currency.toUpperCase();
  const sh=sheet(SHEET_FXRATES),rows=sh.getDataRange().getValues();
  for (let i=1;i<rows.length;i++) { if(rows[i][0].toLowerCase()===projectId.toLowerCase()&&rows[i][1]===currency){sh.getRange(i+1,3).setValue(parseFloat(rate));sh.getRange(i+1,4).setValue(new Date().toISOString());return{updated:true,currency,rate:parseFloat(rate)};} }
  sh.appendRow([projectId,currency,parseFloat(rate),new Date().toISOString()]);
  return { created: true, currency, rate: parseFloat(rate) };
}

// ── EXPENSES ─────────────────────────────────────────────
function addExpense(p) {
  ensureSheets();
  const{projectId,itemName,amount,currency,payerId,payerName,splitBetween}=p;
  if (!projectId||!itemName||!amount||!payerId) throw new Error("Missing required fields");
  const expenseId=Utilities.getUuid().replace(/-/g,"").substring(0,12);
  const splitStr=Array.isArray(splitBetween)?splitBetween.join(","):splitBetween;
  const category=(p.category&&String(p.category).trim())?String(p.category).trim():"";
  const notes=(p.notes&&String(p.notes).trim())?String(p.notes).trim():"";
  const customSplits=(p.customSplits&&p.customSplits!=="null")?p.customSplits:"";
  const expenseDate=(p.expenseDate&&String(p.expenseDate).trim())?String(p.expenseDate).trim():"";
  const logDate=(p.logDate&&String(p.logDate).trim())?String(p.logDate).trim():"";
  const createdAt = new Date().toISOString();
  sheet(SHEET_EXPENSES).appendRow([
    expenseId,projectId,itemName,parseFloat(amount),(currency||"USD").toUpperCase(),
    payerId,payerName,splitStr,category,notes,customSplits,expenseDate,logDate,createdAt
  ]);
  return {
    expenseId,
    expense: {
      expenseId, projectId, itemName, amount: parseFloat(amount),
      currency: (currency||"USD").toUpperCase(),
      payerId, payerName,
      splitBetween: splitStr.split(","),
      category, notes,
      customSplits: customSplits||null,
      expenseDate: expenseDate||null,
      logDate: logDate||null,
      createdAt
    }
  };
}

function editExpense(p) {
  ensureSheets();
  const sh=sheet(SHEET_EXPENSES),rows=sh.getDataRange().getValues(),headers=rows[0];
  const idx=col=>{const i=headers.findIndex(h=>String(h).trim()===col);return i>=0?i+1:null;};
  for (let i=1;i<rows.length;i++) {
    if (String(rows[i][0]).trim()!==String(p.expenseId).trim()) continue;
    if (p.itemName && idx("itemName"))     sh.getRange(i+1,idx("itemName")).setValue(p.itemName.trim());
    if (p.amount && idx("amount"))       sh.getRange(i+1,idx("amount")).setValue(parseFloat(p.amount));
    if (p.currency && idx("currency"))     sh.getRange(i+1,idx("currency")).setValue(p.currency.toUpperCase());
    if (p.payerId && idx("payerId"))      sh.getRange(i+1,idx("payerId")).setValue(p.payerId);
    if (p.payerName && idx("payerName"))    sh.getRange(i+1,idx("payerName")).setValue(p.payerName);
    if (p.splitBetween && idx("splitBetween")) sh.getRange(i+1,idx("splitBetween")).setValue(Array.isArray(p.splitBetween)?p.splitBetween.join(","):p.splitBetween);
    if (p.category!==undefined && idx("category")) sh.getRange(i+1,idx("category")).setValue(p.category||"");
    if (p.notes!==undefined && idx("notes"))    sh.getRange(i+1,idx("notes")).setValue(p.notes||"");
    if (p.customSplits!==undefined && idx("customSplits")) sh.getRange(i+1,idx("customSplits")).setValue(p.customSplits||"");
    if (p.expenseDate!==undefined && idx("expenseDate"))  sh.getRange(i+1,idx("expenseDate")).setValue(p.expenseDate||"");
    if (p.logDate!==undefined && idx("logDate"))      sh.getRange(i+1,idx("logDate")).setValue(p.logDate||"");
    return { edited: true };
  }
  return { error: "Expense not found" };
}

function getExpenses(projectId) {
  const expenses=sheetData(SHEET_EXPENSES).filter(e=>e.projectId.toLowerCase()===projectId.toLowerCase()).map(e=>({
    ...e,
    splitBetween:String(e.splitBetween).split(","),
    category:(e.category&&String(e.category).trim()&&String(e.category).trim()!=="0")?String(e.category).trim():"",
    notes:(e.notes&&String(e.notes).trim())?String(e.notes).trim():"",
    customSplits:(e.customSplits&&String(e.customSplits).trim())?String(e.customSplits).trim():null,
    expenseDate:(e.expenseDate&&String(e.expenseDate).trim())?String(e.expenseDate).trim():null,
    logDate:(e.logDate&&String(e.logDate).trim())?String(e.logDate).trim():null,
  }));
  return { expenses };
}

function deleteExpense(expenseId, projectId) {
  const sh=sheet(SHEET_EXPENSES),rows=sh.getDataRange().getValues();
  for (let i=1;i<rows.length;i++) { if(rows[i][0]===expenseId&&rows[i][1].toLowerCase()===projectId.toLowerCase()){sh.deleteRow(i+1);return{deleted:true};} }
  return { error: "Expense not found" };
}

// ── PAYMENTS ─────────────────────────────────────────────
function addPayment(p) {
  ensureSheets();
  const{projectId,fromId,fromName,toId,toName,amount,currency,note}=p;
  if (!projectId||!fromId||!toId||!amount) throw new Error("Missing required fields");
  const paymentId=Utilities.getUuid().replace(/-/g,"").substring(0,12);
  sheet(SHEET_PAYMENTS).appendRow([paymentId,projectId,fromId,fromName,toId,toName,parseFloat(amount),(currency||"USD").toUpperCase(),note||"",new Date().toISOString()]);
  return { paymentId };
}

function getPayments(projectId) {
  ensureSheets();
  const payments=sheetData(SHEET_PAYMENTS).filter(p=>p.projectId.toLowerCase()===projectId.toLowerCase());
  return { payments };
}

function deletePayment(paymentId, projectId) {
  const sh=sheet(SHEET_PAYMENTS),rows=sh.getDataRange().getValues();
  for (let i=1;i<rows.length;i++) { if(rows[i][0]===paymentId&&rows[i][1].toLowerCase()===projectId.toLowerCase()){sh.deleteRow(i+1);return{deleted:true};} }
  return { error: "Payment not found" };
}

// ── BULK MOVE ────────────────────────────────────────────
function bulkMoveExpenses(expenseIds, fromProjectId, toProjectId) {
  ensureSheets();
  if (!expenseIds || !toProjectId) throw new Error("Missing params");
  const ids = String(expenseIds).split(",").map(s=>s.trim()).filter(Boolean);
  const sh = sheet(SHEET_EXPENSES);
  const rows = sh.getDataRange().getValues();
  const headers = rows[0].map(h=>String(h).trim());
  const pidCol = headers.indexOf("projectId") + 1;
  const eidCol = headers.indexOf("expenseId") + 1;
  let moved = 0;
  for (let i = 1; i < rows.length; i++) {
    const eid = String(rows[i][eidCol-1]).trim();
    if (ids.includes(eid)) {
      sh.getRange(i+1, pidCol).setValue(toProjectId);
      moved++;
    }
  }
  return { moved, total: ids.length };
}

// ── RULES ────────────────────────────────────────────────
function getRules() {
  ensureSheets();
  return { rules: sheetData(SHEET_RULES) };
}

function upsertRule(p) {
  ensureSheets();
  const { keyword, projectId, category, splitBetween, payerId } = p;
  if (!keyword || !projectId) throw new Error("Missing required fields");
  const kw = String(keyword).trim().toLowerCase();
  const splitStr = Array.isArray(splitBetween) ? splitBetween.join(",") : (splitBetween || "");
  const sh = sheet(SHEET_RULES), rows = sh.getDataRange().getValues(), headers = rows[0];
  const idx = col => { const i = headers.findIndex(h => String(h).trim() === col); return i >= 0 ? i + 1 : null; };
  const now = new Date().toISOString();
  // Matched on keyword+project, not keyword alone: the same merchant can mean a different
  // project each time (e.g. "klook" for household vs. europe2026) — each project keeps its
  // own hitCount so import-time matching can rank the more common one.
  for (let i = 1; i < rows.length; i++) {
    const rowKw = String(rows[i][idx("keyword")-1]).trim().toLowerCase();
    const rowPid = String(rows[i][idx("projectId")-1]);
    if (rowKw === kw && rowPid.toLowerCase() === String(projectId).toLowerCase()) {
      const hitCount = (Number(rows[i][idx("hitCount")-1]) || 0) + 1;
      sh.getRange(i+1, idx("category")).setValue(category || "");
      sh.getRange(i+1, idx("splitBetween")).setValue(splitStr);
      sh.getRange(i+1, idx("payerId")).setValue(payerId || "");
      sh.getRange(i+1, idx("hitCount")).setValue(hitCount);
      sh.getRange(i+1, idx("lastUsed")).setValue(now);
      return { ruleId: rows[i][0], keyword: kw, projectId, category: category||"", splitBetween: splitStr, payerId: payerId||"", hitCount, lastUsed: now };
    }
  }
  const ruleId = Utilities.getUuid().replace(/-/g,"").substring(0,12);
  sh.appendRow([ruleId, kw, projectId, category||"", splitStr, payerId||"", 1, now]);
  return { ruleId, keyword: kw, projectId, category: category||"", splitBetween: splitStr, payerId: payerId||"", hitCount: 1, lastUsed: now };
}

function deleteRule(ruleId) {
  const sh = sheet(SHEET_RULES), rows = sh.getDataRange().getValues();
  for (let i=1; i<rows.length; i++) { if (String(rows[i][0])===String(ruleId)) { sh.deleteRow(i+1); return { deleted: true }; } }
  return { error: "Rule not found" };
}

// ── SETTLEMENT ───────────────────────────────────────────
function getSettlement(projectId) {
  const members=sheetData(SHEET_MEMBERS).filter(m=>m.projectId.toLowerCase()===projectId.toLowerCase());
  const expenses=sheetData(SHEET_EXPENSES).filter(e=>e.projectId.toLowerCase()===projectId.toLowerCase()).map(e=>({
    ...e,
    splitBetween:String(e.splitBetween).split(","),
    customSplits:(e.customSplits&&String(e.customSplits).trim())?String(e.customSplits).trim():null,
  }));
  const payments=sheetData(SHEET_PAYMENTS).filter(p=>p.projectId.toLowerCase()===projectId.toLowerCase());
  const project=sheetData(SHEET_PROJECTS).find(p=>p.projectId.toLowerCase()===projectId.toLowerCase());
  const baseCcy=(project&&project.defaultCurrency)||"USD";
  const fxMap={[baseCcy]:1};
  sheetData(SHEET_FXRATES).filter(r=>r.projectId.toLowerCase()===projectId.toLowerCase()).forEach(r=>{fxMap[r.currency.toUpperCase()]=parseFloat(r.rate);});
  if (!expenses.length&&!payments.length) return{transactions:[],balances:[],baseCcy,missingFx:[]};
  const balance={};
  members.forEach(m=>balance[m.memberId]={name:m.name,net:0});

  expenses.forEach(exp=>{
    const ccy=(exp.currency||baseCcy).toUpperCase();
    const fx=fxMap[ccy]!==undefined?fxMap[ccy]:null;
    const raw=parseFloat(exp.amount)||0;
    const amt=fx!==null?raw*fx:raw;
    const split=exp.splitBetween.filter(s=>s);
    if(!split.length) return;
    if(balance[exp.payerId]!==undefined) balance[exp.payerId].net+=amt;
    const custom=(exp.customSplits&&String(exp.customSplits).trim())?
      (()=>{try{return JSON.parse(exp.customSplits);}catch(e){return null;}})():null;
    if(custom){
      const rawTotal=split.reduce((s,id)=>s+(parseFloat(custom[id])||0),0);
      split.forEach(id=>{if(balance[id]!==undefined){const share=rawTotal>0?(parseFloat(custom[id])||0)/rawTotal*amt:amt/split.length;balance[id].net-=share;}});
    } else {
      const share=amt/split.length;
      split.forEach(id=>{if(balance[id]!==undefined) balance[id].net-=share;});
    }
  });

  payments.forEach(pay=>{
    const ccy=(pay.currency||baseCcy).toUpperCase();
    const fx=fxMap[ccy]!==undefined?fxMap[ccy]:1;
    const amt=(parseFloat(pay.amount)||0)*fx;
    if(balance[pay.fromId]!==undefined) balance[pay.fromId].net+=amt;
    if(balance[pay.toId]!==undefined)   balance[pay.toId].net-=amt;
  });

  const creditors=[],debtors=[];
  Object.entries(balance).forEach(([id,{name,net}])=>{
    const r=Math.round(net*100)/100;
    if(r>0.01) creditors.push({id,name,amount:r});
    if(r<-0.01) debtors.push({id,name,amount:-r});
  });
  creditors.sort((a,b)=>b.amount-a.amount);
  debtors.sort((a,b)=>b.amount-a.amount);
  const transactions=[];
  let ci=0,di=0;
  while(ci<creditors.length&&di<debtors.length){
    const c=creditors[ci],d=debtors[di];
    const t=Math.min(c.amount,d.amount);
    transactions.push({from:d.name,to:c.name,amount:Math.round(t*100)/100});
    c.amount-=t;d.amount-=t;
    if(c.amount<0.01) ci++;
    if(d.amount<0.01) di++;
  }
  const missingFx=[...new Set(expenses.filter(e=>{const ccy=(e.currency||baseCcy).toUpperCase();return ccy!==baseCcy&&fxMap[ccy]===undefined;}).map(e=>e.currency.toUpperCase()))];
  return{transactions,balances:Object.entries(balance).map(([id,{name,net}])=>({id,name,net:Math.round(net*100)/100})),baseCcy,missingFx};
}
