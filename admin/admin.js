const $=selector=>document.querySelector(selector);
let csrf='', user=null, calendarDate=new Date(), calendarView='month', appointments=[],calendarData={rules:[],exceptions:[],timezone:'America/Toronto'};
const roleNames={OWNER:'Propriétaire',ADMIN:'Administrateur',STAFF:'Équipe',VIEWER:'Lecture seule'};
const statusNames={PENDING:'En attente',CONFIRMED:'Confirmé',REJECTED:'Refusé',CANCELLED:'Annulé',COMPLETED:'Terminé'};
const dateString=date=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
const dateFromString=value=>new Date(value+'T12:00:00');
const addDays=(date,n)=>{const result=new Date(date);result.setDate(result.getDate()+n);return result};
const timeFromMin=minutes=>`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
const status=(message,error=false)=>{$('#admin-status').textContent=message;$('#admin-status').classList.toggle('error',error)};
const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node};
async function api(path,options={}) {
  const response=await fetch('/api/admin'+path,{
    credentials:'same-origin',
    headers:{'content-type':'application/json',...(csrf?{'x-csrf-token':csrf}:{})},
    ...options
  });
  const data=await response.json();
  if (!response.ok) throw new Error(data.error||'Erreur de connexion');
  return data;
}
function formData(form){return Object.fromEntries(new FormData(form).entries())}
function showApp(data) {
  user=data.user;csrf=data.csrf;
  $('#login-view').hidden=true;$('#invite-view').hidden=true;$('#app-view').hidden=false;$('#admin-user').hidden=false;
  $('#admin-identity').textContent=user.name;$('#role-label').textContent=roleNames[user.role];
  document.querySelectorAll('[data-permission="availability"]').forEach(x=>x.hidden=!['OWNER','ADMIN'].includes(user.role));
  document.querySelectorAll('[data-permission="team"]').forEach(x=>x.hidden=user.role!=='OWNER');
  switchTab('appointments');
}
function switchTab(tab) {
  for(const name of ['appointments','availability','team']) {
    $('#'+name+'-panel').hidden=name!==tab;
    document.querySelector(`[data-tab="${name}"]`).setAttribute('aria-current',name===tab?'page':'false');
  }
  if(tab==='appointments') loadAppointments();
  if(tab==='availability') loadAvailability();
  if(tab==='team') loadTeam();
}
function range() {
  let from,to;
  if(calendarView==='month') {
    from=new Date(calendarDate.getFullYear(),calendarDate.getMonth(),1);
    to=new Date(calendarDate.getFullYear(),calendarDate.getMonth()+1,0);
  } else if(calendarView==='week') {
    const shift=(calendarDate.getDay()+6)%7;
    from=addDays(calendarDate,-shift);to=addDays(from,6);
  } else if(calendarView==='day') from=to=calendarDate;
  else {from=new Date();to=addDays(from,30)}
  return {from:dateString(from),to:dateString(to)};
}
async function loadAppointments() {
  try {
    const {from,to}=range();
    const [result,stats]=await Promise.all([api('/appointments?from='+from+'&to='+to),api('/stats')]);
    appointments=result.appointments;calendarData=result;
    renderStats(stats);
    const serviceFilter=$('#service-filter'),current=serviceFilter.value;
    serviceFilter.replaceChildren(el('option','','Tous les services'));
    serviceFilter.firstChild.value='';
    [...new Set(appointments.map(item=>item.service))].sort().forEach(service=>{
      const option=el('option','',service);option.value=service;serviceFilter.append(option);
    });
    serviceFilter.value=current;
    renderCalendar();
    renderAppointments();
  }catch(error){status(error.message,true)}
}
function renderStats(stats) {
  const values=[
    ['Rendez-vous aujourd’hui',stats.today],
    ['En attente',stats.pending],
    ['Confirmés',stats.confirmed],
    ['Cette semaine',stats.week]
  ];
  const container=$('#admin-stats');container.replaceChildren();
  values.forEach(([label,count])=>{const card=el('div','stat');card.append(el('strong','',String(count)),el('span','',label));container.append(card)});
}
function renderCalendar() {
  const holder=$('#admin-calendar');holder.replaceChildren();
  const {from,to}=range();
  const title=calendarView==='month'?new Intl.DateTimeFormat('fr-CA',{month:'long',year:'numeric'}).format(calendarDate):calendarView==='list'?'30 prochains jours':`${from} — ${to}`;
  $('#calendar-title').textContent=title;
  if(calendarView==='list'){
    const list=el('div','calendar-list');
    appointments.forEach(item=>{
      const row=el('div','appointment-row');
      row.append(el('strong','',`${item.date} ${timeFromMin(item.start_min)} · ${item.first_name} ${item.last_name}`),el('span','status-'+item.status,statusNames[item.status]));
      list.append(row);
    });
    if(!appointments.length)list.textContent='Aucun rendez-vous à venir.';
    holder.append(list);return;
  }
  const start=dateFromString(from),end=dateFromString(to),today=dateString(new Date());
  if(calendarView==='month'){
    const offset=(start.getDay()+6)%7;
    for(let n=offset;n>0;n--) addDay(addDays(start,-n),true);
  }
  for(let day=start;day<=end;day=addDays(day,1)) addDay(day,false);
  function addDay(day,outside) {
    const date=dateString(day),items=appointments.filter(x=>x.date===date);
    const cell=el('div','calendar-day'+(outside?' outside':'')+(date===today?' is-today':''));
    cell.append(el('b','',String(day.getDate())));
    if(calendarView!=='month')cell.append(el('span','',new Intl.DateTimeFormat('fr-CA',{weekday:'long'}).format(day)));
    const weekdayNames=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const weekday=weekdayNames.indexOf(new Intl.DateTimeFormat('en-US',{weekday:'short',timeZone:calendarData.timezone}).format(new Date(date+'T12:00:00Z')));
    const ranges=calendarData.rules.filter(rule=>rule.weekday===weekday);
    ranges.forEach(rule=>cell.append(el('small','availability-mark',`Disponible ${timeFromMin(rule.start_min)}–${timeFromMin(rule.end_min)}`)));
    const dayExceptions=calendarData.exceptions.filter(exception=>{
      const start=new Intl.DateTimeFormat('en-CA',{timeZone:calendarData.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(exception.start_utc));
      const end=new Intl.DateTimeFormat('en-CA',{timeZone:calendarData.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(exception.end_utc-1));
      return date>=start&&date<=end;
    });
    dayExceptions.forEach(exception=>cell.append(el('small',exception.kind==='BLOCK'?'blocked-mark':'availability-mark',`${exception.kind==='BLOCK'?'Bloqué':'Ouverture'} · ${exception.note||'exception'}`)));
    if(dayExceptions.some(exception=>exception.kind==='BLOCK'))cell.classList.add('has-block');
    items.forEach(item=>cell.append(el('small','status-'+item.status,`${timeFromMin(item.start_min)} ${item.first_name} ${item.last_name} · ${statusNames[item.status]}`)));
    holder.append(cell);
  }
}
function renderAppointments() {
  const search=$('#search').value.trim().toLowerCase(),filter=$('#status-filter').value,service=$('#service-filter').value,date=$('#date-filter').value,holder=$('#appointment-list');
  holder.replaceChildren();
  appointments.filter(item=>(!filter||item.status===filter)&&(!service||item.service===service)&&(!date||item.date===date)&&(!search||`${item.first_name} ${item.last_name} ${item.email}`.toLowerCase().includes(search))).forEach(item=>{
    const row=el('div','appointment-row'),left=el('div'),right=el('div');
    left.append(el('strong','',`${item.first_name} ${item.last_name} · ${item.service}`));
    left.append(el('small','',`${item.date} à ${timeFromMin(item.start_min)} · ${item.email} · ${item.phone}`));
    if(item.message)left.append(el('small','',item.message));
    right.append(el('span','status-'+item.status,statusNames[item.status]+' '));
    if(user.role!=='VIEWER'){
      const edit=el('button','','Modifier');edit.type='button';edit.addEventListener('click',()=>openEditor(item));right.append(edit);
      if(item.status==='PENDING'){
        for(const [label,value] of [['Confirmer','CONFIRMED'],['Refuser','REJECTED']]){
          const button=el('button','',label);button.type='button';button.addEventListener('click',()=>saveAppointment(item.id,{status:value}));right.append(button);
        }
      }
    }
    row.append(left,right);holder.append(row);
  });
}
function openEditor(item) {
  const form=$('#appointment-form');form.elements.id.value=item.id;form.elements.date.value=item.date;
  form.elements.time.value=timeFromMin(item.start_min);form.elements.status.value=item.status;
  form.elements.firstName.value=item.first_name;form.elements.lastName.value=item.last_name;
  form.elements.email.value=item.email;form.elements.phone.value=item.phone;form.elements.service.value=item.service;
  form.elements.location.value=item.location;form.elements.message.value=item.message;
  $('#appointment-editor').hidden=false;$('#appointment-editor').scrollIntoView({behavior:'smooth',block:'center'});
}
async function saveAppointment(id,patch) {
  try {await api('/appointments/'+id,{method:'PATCH',body:JSON.stringify(patch)});status('Rendez-vous mis à jour.');$('#appointment-editor').hidden=true;await loadAppointments();}
  catch(error){status(error.message,true)}
}
async function loadAvailability() {
  try {
    const data=await api('/availability');
    const form=$('#settings-form');form.elements.duration.value=data.settings.duration;form.elements.buffer.value=data.settings.buffer;form.elements.timezone.value=data.settings.timezone;
    const days=['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
    const rules=$('#rules-list');rules.replaceChildren();
    data.rules.forEach(item=>{
      const row=el('div','record-row');row.append(el('span','',`${days[item.weekday]} · ${timeFromMin(item.start_min)}–${timeFromMin(item.end_min)}`));
      const edit=el('button','','Modifier');edit.addEventListener('click',()=>{
        const form=$('#rule-form');form.elements.id.value=item.id;form.elements.weekday.value=item.weekday;
        form.elements.start.value=timeFromMin(item.start_min);form.elements.end.value=timeFromMin(item.end_min);
        $('#rule-submit').textContent='Mettre à jour la plage';$('#rule-cancel').hidden=false;form.scrollIntoView({behavior:'smooth',block:'center'});
      });row.append(edit);
      const remove=el('button','','Supprimer');remove.addEventListener('click',()=>removeRecord('/availability/'+item.id,loadAvailability));row.append(remove);rules.append(row);
    });
    const exceptions=$('#exceptions-list');exceptions.replaceChildren();
    data.exceptions.forEach(item=>{
      const row=el('div','record-row');row.append(el('span','',`${item.kind==='BLOCK'?'Indisponible':'Disponible'} · ${new Date(item.start_utc).toLocaleString('fr-CA',{timeZone:data.settings.timezone})} – ${new Date(item.end_utc).toLocaleString('fr-CA',{timeZone:data.settings.timezone})} · ${item.note}`));
      const remove=el('button','','Supprimer');remove.addEventListener('click',()=>removeRecord('/exceptions/'+item.id,loadAvailability));row.append(remove);exceptions.append(row);
    });
  }catch(error){status(error.message,true)}
}
async function removeRecord(path,reload) {
  try {await api(path,{method:'DELETE'});status('Élément supprimé.');await reload();}
  catch(error){status(error.message,true)}
}
async function loadTeam() {
  try {
    const {users}=await api('/team'),holder=$('#team-list');holder.replaceChildren();
    users.forEach(member=>{
      const row=el('div','record-row'),info=el('div');
      info.append(el('strong','',`${member.name} · ${roleNames[member.role]}`),el('small','',`${member.email} · ${member.active?'Actif':'Désactivé'} · ${member.enrolled?'Accès créé':'Invitation en attente'}`));
      row.append(info);
      if(member.role!=='OWNER'){
        const select=el('select');for(const role of ['ADMIN','STAFF','VIEWER']){const option=el('option','',roleNames[role]);option.value=role;option.selected=member.role===role;select.append(option)}
        select.addEventListener('change',()=>changeMember(member.id,{role:select.value}));row.append(select);
        const toggle=el('button','',member.active?'Désactiver':'Réactiver');toggle.addEventListener('click',()=>changeMember(member.id,{active:!member.active}));row.append(toggle);
      }
      holder.append(row);
    });
  }catch(error){status(error.message,true)}
}
async function changeMember(id,patch) {
  try {await api('/team/'+id,{method:'PATCH',body:JSON.stringify(patch)});status('Accès mis à jour.');await loadTeam();}
  catch(error){status(error.message,true)}
}
$('#login-form').addEventListener('submit',async event=>{
  event.preventDefault();
  try{showApp(await api('/login',{method:'POST',body:JSON.stringify(formData(event.currentTarget))}));status('Connexion réussie.')}
  catch(error){status(error.message,true)}
});
$('#invite-form').addEventListener('submit',async event=>{
  event.preventDefault();
  try{
    await api('/invite/accept',{method:'POST',body:JSON.stringify({token:location.hash.slice(8),password:event.currentTarget.elements.password.value})});
    history.replaceState(null,'',location.pathname);$('#invite-view').hidden=true;$('#login-view').hidden=false;status('Accès créé. Connectez-vous.');
  }catch(error){status(error.message,true)}
});
$('#logout').addEventListener('click',async()=>{try{await api('/logout',{method:'POST'});}finally{location.reload()}});
document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>switchTab(button.dataset.tab)));
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{
  calendarView=button.dataset.view;document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('selected',x===button));loadAppointments();
}));
$('#calendar-prev').addEventListener('click',()=>moveCalendar(-1));
$('#calendar-next').addEventListener('click',()=>moveCalendar(1));
function moveCalendar(direction) {
  if(calendarView==='month')calendarDate=new Date(calendarDate.getFullYear(),calendarDate.getMonth()+direction,1);
  else calendarDate=addDays(calendarDate,direction*(calendarView==='week'?7:1));
  loadAppointments();
}
$('#search').addEventListener('input',renderAppointments);$('#status-filter').addEventListener('change',renderAppointments);$('#service-filter').addEventListener('change',renderAppointments);
$('#date-filter').addEventListener('change',event=>{
  if(!event.target.value){calendarView='month';document.querySelector('[data-view="month"]').classList.add('selected');loadAppointments();return;}
  calendarDate=dateFromString(event.target.value);calendarView='day';
  document.querySelectorAll('[data-view]').forEach(button=>button.classList.toggle('selected',button.dataset.view==='day'));loadAppointments();
});
$('#close-editor').addEventListener('click',()=>{$('#appointment-editor').hidden=true});
$('#appointment-form').addEventListener('submit',event=>{
  event.preventDefault();const input=formData(event.currentTarget);delete input.id;
  saveAppointment(event.currentTarget.elements.id.value,input);
});
$('#settings-form').addEventListener('submit',async event=>{
  event.preventDefault();try{await api('/settings',{method:'PATCH',body:JSON.stringify(formData(event.currentTarget))});status('Paramètres enregistrés.');}catch(error){status(error.message,true)}
});
$('#rule-form').addEventListener('submit',async event=>{
  event.preventDefault();try{
    const form=event.currentTarget,input=formData(form),editing=Boolean(input.id);
    await api(editing?'/availability/'+input.id:'/availability',{method:editing?'PATCH':'POST',body:JSON.stringify(input)});
    form.reset();$('#rule-submit').textContent='Ajouter la plage';$('#rule-cancel').hidden=true;
    status(editing?'Plage mise à jour.':'Plage ajoutée.');loadAvailability();
  }catch(error){status(error.message,true)}
});
$('#rule-cancel').addEventListener('click',()=>{$('#rule-form').reset();$('#rule-submit').textContent='Ajouter la plage';$('#rule-cancel').hidden=true});
$('#exception-form').addEventListener('submit',async event=>{
  event.preventDefault();try{await api('/exceptions',{method:'POST',body:JSON.stringify(formData(event.currentTarget))});event.currentTarget.reset();status('Exception ajoutée.');loadAvailability();}catch(error){status(error.message,true)}
});
$('#team-form').addEventListener('submit',async event=>{
  event.preventDefault();try{
    const result=await api('/team',{method:'POST',body:JSON.stringify(formData(event.currentTarget))});
    const box=$('#invite-link'),input=el('input');input.readOnly=true;input.value=result.inviteUrl;
    box.replaceChildren(el('strong','','Lien privé à transmettre à la personne invitée :'),input);
    box.hidden=false;event.currentTarget.reset();status('Invitation créée.');loadTeam();
  }catch(error){status(error.message,true)}
});
if(location.hash.startsWith('#invite=')){$('#login-view').hidden=true;$('#invite-view').hidden=false;}
else api('/me').then(showApp).catch(()=>{});
