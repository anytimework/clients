import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const files = ['index.html', 'portal'];

const oldLoadCore = `  async loadCore(){
    if(!this.sb) return;
    try {
      const {data,error}=await this.sb.from('client_portal_accounts').select('legacy_client_id,auth_user_id,legacy_contact_email,login_email,email_status,access_enabled,display_name,outlets,roster_enabled,pays_by_card,created_at,updated_at').order('display_name');
      if(error) throw error;
      const clients=(data||[]).map(x=>this.portalAccount(x));
      this.accounts={owner:{},clients,workers:[],deletedIds:[]};
      const names=Array.from(new Set(clients.flatMap(x=>x.outlets||[]))).sort();
      this.outlets=names.map(name=>({name,country:'',location:''}));
    } catch(e){ this.accounts={owner:{},clients:[],workers:[],deletedIds:[]}; this.outlets=[]; }
  }
  portalAccount(x){ return {id:x.legacy_client_id,name:x.display_name,username:x.login_email||'',email:x.login_email||x.legacy_contact_email||'',legacyContactEmail:x.legacy_contact_email||'',outlets:x.outlets||[],rosterEnabled:!!x.roster_enabled,paysByCard:!!x.pays_by_card,accessEnabled:!!x.access_enabled,emailStatus:x.email_status,authUserId:x.auth_user_id,createdAt:x.created_at,pwChangedAt:null,emailChangedAt:x.updated_at}; }`;

const newLoadCore = `  async loadCore(){
    if(!this.sb) return;
    try {
      const {data,error}=await this.sb.from('client_portal_accounts').select('legacy_client_id,auth_user_id,legacy_contact_email,login_email,email_status,access_enabled,display_name,outlets,outlet_links,roster_enabled,pays_by_card,created_at,updated_at').order('display_name');
      if(error) throw error;
      const clients=(data||[]).map(x=>this.portalAccount(x));
      this.accounts={owner:{},clients,workers:[],deletedIds:[]};
      let sourceOutlets=[];
      try {
        const {data:sourceData,error:sourceError}=await this.sb.functions.invoke('sync-shiftops',{body:{catalog_only:true}});
        if(!sourceError&&sourceData){
          sourceOutlets=Array.isArray(sourceData.outlet_catalog)?sourceData.outlet_catalog:[];
          this.portalUsers=Array.isArray(sourceData.portal_users)?sourceData.portal_users:[];
        }
      } catch(syncError){}
      const byName=new Map();
      sourceOutlets.forEach(outlet=>{ const name=String((outlet&&outlet.name)||'').trim(); if(name) byName.set(name,{name,country:(outlet&&outlet.country)||'',location:(outlet&&outlet.location)||''}); });
      clients.flatMap(x=>x.outlets||[]).forEach(rawName=>{ const name=String(rawName||'').trim(); if(name&&!byName.has(name)) byName.set(name,{name,country:'',location:''}); });
      this.outlets=Array.from(byName.values()).sort((a,b)=>a.name.localeCompare(b.name));
    } catch(e){ this.accounts={owner:{},clients:[],workers:[],deletedIds:[]}; this.outlets=[]; }
  }
  portalAccount(x){ return {id:x.legacy_client_id,name:x.display_name,username:x.login_email||'',email:x.login_email||x.legacy_contact_email||'',legacyContactEmail:x.legacy_contact_email||'',outlets:x.outlets||[],outletLinks:x.outlet_links||{},rosterEnabled:!!x.roster_enabled,paysByCard:!!x.pays_by_card,accessEnabled:!!x.access_enabled,emailStatus:x.email_status,authUserId:x.auth_user_id,createdAt:x.created_at,pwChangedAt:null,emailChangedAt:x.updated_at}; }`;

const oldLoadPortalUsers = `  async loadPortalUsers(){
    this.portalUsers=[];
    return this.portalUsers;
  }`;

const newLoadPortalUsers = `  async loadPortalUsers(){
    if(this.portalUsers.length) return this.portalUsers;
    try {
      const {data,error}=await this.sb.functions.invoke('sync-shiftops',{body:{catalog_only:true}});
      if(!error&&data){
        const catalog=Array.isArray(data.outlet_catalog)?data.outlet_catalog:[];
        const byName=new Map(this.outlets.map(outlet=>[outlet.name,outlet]));
        catalog.forEach(outlet=>{ const name=String((outlet&&outlet.name)||'').trim(); if(name) byName.set(name,{name,country:(outlet&&outlet.country)||'',location:(outlet&&outlet.location)||''}); });
        this.outlets=Array.from(byName.values()).sort((a,b)=>a.name.localeCompare(b.name));
        this.portalUsers=Array.isArray(data.portal_users)?data.portal_users:[];
      }
    } catch(e){ this.portalUsers=[]; }
    return this.portalUsers;
  }`;

const oldSaveClient = `  async saveClient(){
    const d=this.state.editingClient; const name=(d.name||'').trim(); const login=(d.username||'').trim().toLowerCase();
    if(!name){ this.flash('Enter a client name.'); return; }
    if(d.accessEnabled&&!login){ this.flash('Enter a verified login email before enabling access.'); return; }
    try {
      if(!d.id){
        const {data,error}=await this.sb.rpc('admin_create_client_portal_account',{p_display_name:name,p_legacy_contact_email:(d.legacyContactEmail||d.email||'').trim()||null,p_outlets:d.outlets||[]});
        if(error) throw error;
        if(login&&data&&data.legacy_client_id){ const {error:accessError}=await this.sb.rpc('admin_update_client_portal_access',{p_legacy_client_id:data.legacy_client_id,p_login_email:login,p_access_enabled:!!d.accessEnabled}); if(accessError) throw accessError; }
      } else {
        const {error}=await this.sb.rpc('admin_update_client_portal_access',{p_legacy_client_id:d.id,p_login_email:login||null,p_access_enabled:!!d.accessEnabled});
        if(error) throw error;
      }
      await this.loadCore(); this.setState({editingClient:null}); this.flash(d.id?'Login access saved.':'Client added with access disabled.');
    } catch(e){ this.flash('Save failed: '+(e.message||e)); }
  }`;

const newSaveClient = `  async saveClient(){
    const d=this.state.editingClient; const name=(d.name||'').trim(); const login=(d.username||'').trim().toLowerCase();
    if(!name){ this.flash('Enter a client name.'); return; }
    if(d.accessEnabled&&!login){ this.flash('Enter a verified login email before enabling access.'); return; }
    try {
      let clientId=d.id;
      if(!clientId){
        const {data,error}=await this.sb.rpc('admin_create_client_portal_account',{p_display_name:name,p_legacy_contact_email:(d.legacyContactEmail||d.email||'').trim()||null,p_outlets:d.outlets||[]});
        if(error) throw error;
        clientId=data&&data.legacy_client_id;
        if(!clientId) throw new Error('The new client account did not return an ID.');
      }
      const {error:profileError}=await this.sb.rpc('admin_update_client_portal_profile',{
        p_legacy_client_id:clientId,
        p_display_name:name,
        p_legacy_contact_email:(d.legacyContactEmail||'').trim()||null,
        p_outlets:d.outlets||[],
        p_outlet_links:d.outletLinks||{},
        p_roster_enabled:!!d.rosterEnabled,
        p_pays_by_card:!!d.paysByCard
      });
      if(profileError) throw profileError;
      const {error:accessError}=await this.sb.rpc('admin_update_client_portal_access',{p_legacy_client_id:clientId,p_login_email:login||null,p_access_enabled:!!d.accessEnabled});
      if(accessError) throw accessError;
      await this.loadCore(); this.setState({editingClient:null}); this.flash('Client saved.');
    } catch(e){ this.flash('Save failed: '+(e.message||e)); }
  }`;

const accountColumns = 'legacy_client_id,auth_user_id,legacy_contact_email,login_email,email_status,access_enabled,display_name,outlets,roster_enabled,pays_by_card,created_at,updated_at';
const accountColumnsWithLinks = 'legacy_client_id,auth_user_id,legacy_contact_email,login_email,email_status,access_enabled,display_name,outlets,outlet_links,roster_enabled,pays_by_card,created_at,updated_at';

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`);
  return source.replace(before, after);
}

function patchTemplate(template) {
  let next = replaceOnce(template, oldLoadCore, newLoadCore, 'loadCore');
  next = replaceOnce(next, oldLoadPortalUsers, newLoadPortalUsers, 'loadPortalUsers');
  next = replaceOnce(next, oldSaveClient, newSaveClient, 'saveClient');
  next = replaceOnce(next, accountColumns, accountColumnsWithLinks, 'client session account columns');
  return next;
}

const cleanBase = execFileSync('git', ['show', 'HEAD:index.html'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

for (const file of files) {
  const raw = cleanBase;
  const pattern = /(<script type="__bundler\/template">\s*)([\s\S]*?)(\s*<\/script>)/;
  const match = raw.match(pattern);
  if (!match) throw new Error(`${file}: bundled template not found`);
  const template = JSON.parse(match[2]);
  const patched = patchTemplate(template);
  const encoded = JSON.stringify(patched).replaceAll('</', '<\\u002F');
  fs.writeFileSync(file, raw.replace(pattern, (_all, prefix, _old, suffix) => `${prefix}${encoded}${suffix}`));
}
