(() => {
  const $ = (selector) => document.querySelector(selector);
  const header = $('.site-header');
  const menu = $('.menu-toggle');
  const nav = $('.main-nav');
  const setHeader = () => header.classList.toggle('scrolled', window.scrollY > 12);
  setHeader();
  window.addEventListener('scroll', setHeader, { passive: true });
  menu.addEventListener('click', () => {
    const open = menu.getAttribute('aria-expanded') !== 'true';
    menu.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
    nav.classList.toggle('open', open);
  });
  nav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
    nav.classList.remove('open');
    menu.setAttribute('aria-expanded', 'false');
    menu.setAttribute('aria-label', 'Ouvrir le menu');
  }));

  const serviceIntros = {
    'Déclarations d’impôts de particuliers':'ma déclaration d’impôts de particulier',
    'Crédits d’impôt':'les crédits d’impôt auxquels je pourrais avoir droit',
    'Gains en capital':'l’imposition de mes gains en capital',
    'Revenus locatifs':'la déclaration de mes revenus locatifs',
    'Travailleurs autonomes':'mes besoins comptables et fiscaux comme travailleur autonome',
    'Situations particulières':'une situation fiscale particulière',
    'Estimations et calculs fiscaux':'une estimation ou un calcul fiscal',
    'Autres formulaires spéciaux':'la préparation d’un formulaire particulier',
    'Production de feuillets fiscaux':'la production de feuillets fiscaux',
    'Paie':'la production de la paie, les relevés d’emploi et les déductions à la source',
    'Déclarations d’impôts de sociétés':'la déclaration d’impôts de ma société',
    'Tenue de livres':'la tenue de mes livres comptables',
    'Rapports de taxes':'mes déclarations de TPS et TVQ',
    'Déclarations d’impôts de fiducies':'une déclaration d’impôts de fiducie',
    Onvio:'mon accès à Onvio'
  };
  const serviceSelect = $('#service');
  const messageField = $('#message');
  function prefillServiceMessage(service) {
    const subject = serviceIntros[service];
    if (!subject) return;
    const details = messageField.value.trim().replace(/^Bonjour Patricia,\s*\n\s*\nJe souhaite obtenir de l.aide concernant [^\n]*\.\s*/i, '').trim();
    messageField.value = `Bonjour Patricia,\n\nJe souhaite obtenir de l’aide concernant ${subject}.\n\n${details || 'Ma situation : '}`;
  }
  document.querySelectorAll('.service-action[data-service]').forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    serviceSelect.value = link.dataset.service;
    setContactMode('message');
    prefillServiceMessage(serviceSelect.value);
    history.replaceState(null, '', '#contact');
    messageField.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (window.matchMedia('(min-width: 700px)').matches) window.setTimeout(() => {
      messageField.focus({ preventScroll: true });
      messageField.setSelectionRange(messageField.value.length, messageField.value.length);
    }, 450);
  }));
  serviceSelect.addEventListener('change', () => prefillServiceMessage(serviceSelect.value));

  const revealItems = document.querySelectorAll('[data-reveal]');
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); }
    }), { threshold: .12, rootMargin: '0px 0px -30px 0px' });
    revealItems.forEach(item => observer.observe(item));
  } else revealItems.forEach(item => item.classList.add('visible'));

  $('#newsletter-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const email = form.elements.email.value.trim();
    const subject = encodeURIComponent('Inscription à l’infolettre');
    const body = encodeURIComponent(`Bonjour Patricia,\n\nJe souhaite m’inscrire à votre infolettre.\n\nMon adresse courriel : ${email}\n\nMerci !`);
    $('#newsletter-status').textContent = 'Votre application courriel va s’ouvrir avec une demande d’inscription préremplie.';
    window.location.href = `mailto:patricialanctot@hotmail.com?subject=${subject}&body=${body}`;
  });

  const contactForm = $('#contact-form');
  const appointmentDate = $('#appointment-date');
  const bookingTime = $('#appointment-time');
  const bookingCalendar = $('#booking-calendar');
  const calendarStatus = $('#calendar-status');
  const detailsPanel = $('#booking-details');
  const summaryText = $('#booking-summary-text');
  const schedulePanel = $('#panel-appointment');
  const messagePanel = $('#panel-message');
  const modeTabs = [...document.querySelectorAll('.contact-mode-tab')];
  const submitButton = $('#contact-submit');
  const submitNote = $('#contact-submit-note');
  let contactMode = 'appointment';
  let selectedDay = '';
  let bookingDuration = 30;
  let bookingTimezone = 'America/Toronto';
  const monthCursor = new Date();
  monthCursor.setDate(1);
  const bookingApi = (window.PATRICIA_SITE_CONFIG?.apiBaseUrl || '').replace(/\/$/, '');
  const localDate = (date) => [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
  const localToday = () => localDate(new Date());

  async function loadPublicCalendar() {
    const year=monthCursor.getFullYear(), month=monthCursor.getMonth();
    $('#booking-month').textContent=new Intl.DateTimeFormat('fr-CA',{month:'long',year:'numeric'}).format(monthCursor);
    const today=new Date();today.setHours(0,0,0,0);
    const minMonth=new Date(today.getFullYear(),today.getMonth(),1),maxMonth=new Date(today.getFullYear(),today.getMonth()+2,1);
    $('#booking-prev').disabled=monthCursor<=minMonth;
    $('#booking-next').disabled=monthCursor>=maxMonth;
    bookingCalendar.replaceChildren();calendarStatus.textContent='Chargement des disponibilités…';
    const first=new Date(year,month,1),count=new Date(year,month+1,0).getDate(),offset=(first.getDay()+6)%7;
    for(let i=0;i<offset;i++){const blank=document.createElement('span');blank.className='booking-day empty';bookingCalendar.append(blank);}
    try {
      const from=localDate(first),to=localDate(new Date(year,month+1,0));
      const response=await fetch(bookingApi+'/api/public/days?from='+from+'&to='+to,{credentials:'omit'});
      if(!response.ok)throw new Error('offline');
      const adminLink=$('#admin-link');
      if(adminLink){adminLink.href=new URL('/admin/',bookingApi||location.origin).href;adminLink.hidden=false;}
      const result=await response.json(),days=Object.fromEntries(result.days.map(day=>[day.date,day.available]));
      calendarStatus.textContent=Object.values(days).some(Boolean)?'Choisissez une journée avec une disponibilité.':'Aucune plage disponible ce mois-ci.';
      for(let number=1;number<=count;number++){
        const date=new Date(year,month,number),key=localDate(date),button=document.createElement('button');
        button.type='button';button.className='booking-day';button.textContent=String(number);
        button.setAttribute('aria-label',new Intl.DateTimeFormat('fr-CA',{weekday:'long',year:'numeric',month:'long',day:'numeric'}).format(date));
        const available=Boolean(days[key])&&date>=today;
        button.disabled=!available;button.classList.toggle('available',available);
        if(key===selectedDay)button.classList.add('selected');
        if(key===localToday())button.classList.add('today');
        if(available)button.addEventListener('click',()=>selectBookingDay(key,button));
        bookingCalendar.append(button);
      }
    } catch {
      calendarStatus.textContent='Les réservations en ligne seront accessibles lorsque l’espace de rendez-vous sera mis en service.';
      for(let number=1;number<=count;number++){const disabled=document.createElement('button');disabled.type='button';disabled.className='booking-day';disabled.textContent=String(number);disabled.disabled=true;bookingCalendar.append(disabled);}
    }
  }
  async function selectBookingDay(date,button) {
    selectedDay=date;appointmentDate.value=date;
    bookingCalendar.querySelectorAll('.selected').forEach(item=>item.classList.remove('selected'));button.classList.add('selected');
    $('#slot-field').hidden=true;detailsPanel.hidden=true;bookingTime.replaceChildren(new Option('Chargement…',''));
    calendarStatus.textContent='Recherche des heures disponibles…';
    try {
      const response=await fetch(bookingApi+'/api/public/slots?date='+encodeURIComponent(date),{credentials:'omit'});
      if(!response.ok)throw new Error('offline');
      const result=await response.json();
      bookingDuration=result.duration||bookingDuration;
      bookingTimezone=result.timezone||bookingTimezone;
      bookingTime.replaceChildren(new Option('Choisir une heure',''));
      result.slots.forEach(time=>bookingTime.add(new Option(time,time)));
      bookingTime.options[0].disabled=true;$('#slot-field').hidden=false;
      calendarStatus.textContent=result.slots.length?'Choisissez une heure disponible.':'Cette date n’a plus de plage disponible.';
    } catch { calendarStatus.textContent='Impossible de récupérer les heures. Réessayez dans un instant.'; }
    updateBookingSummary();
  }
  bookingTime.addEventListener('change',()=>{
    detailsPanel.hidden=!bookingTime.value;updateBookingSummary();
    if(bookingTime.value)detailsPanel.scrollIntoView({behavior:'smooth',block:'nearest'});
  });
  function updateBookingSummary() {
    const date=appointmentDate.value;
    const dateLabel=date?new Intl.DateTimeFormat('fr-CA',{weekday:'long',year:'numeric',month:'long',day:'numeric',timeZone:bookingTimezone}).format(new Date(date+'T12:00:00Z')):'Date à choisir';
    const fullName=[$('#booking-first-name').value,$('#booking-last-name').value].filter(Boolean).join(' ')||'Nom à ajouter';
    summaryText.textContent=`${dateLabel} · ${bookingTime.value||'Heure à choisir'} · ${bookingDuration} min · ${serviceSelect.value||'Service à choisir'} · ${fullName}`;
  }
  $('#booking-prev').addEventListener('click',()=>{monthCursor.setMonth(monthCursor.getMonth()-1);loadPublicCalendar();});
  $('#booking-next').addEventListener('click',()=>{monthCursor.setMonth(monthCursor.getMonth()+1);loadPublicCalendar();});
  loadPublicCalendar();
  bookingTime.addEventListener('change',updateBookingSummary);
  serviceSelect.addEventListener('change',updateBookingSummary);
  ['#booking-first-name','#booking-last-name','#booking-email'].forEach(selector=>$(selector).addEventListener('input',updateBookingSummary));

  function setContactMode(mode) {
    contactMode=mode;
    const isAppointment=mode==='appointment';
    schedulePanel.hidden=!isAppointment;messagePanel.hidden=isAppointment;
    serviceSelect.required=isAppointment;bookingTime.required=isAppointment;
    $('#appointment-location').required=isAppointment;
    ['#booking-first-name','#booking-last-name','#booking-email','#booking-phone'].forEach(selector=>$(selector).required=isAppointment);
    ['#message-first-name','#message-last-name','#message-email'].forEach(selector=>$(selector).required=!isAppointment);
    messageField.required=!isAppointment;
    modeTabs.forEach(tab=>{
      const selected=tab.dataset.contactMode===mode;
      tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;
    });
    submitButton.innerHTML=isAppointment?'Demander un rendez-vous <span aria-hidden="true">→</span>':'Envoyer mon message <span aria-hidden="true">→</span>';
    submitNote.textContent=isAppointment?'Votre demande sera transmise à Patricia et restera en attente de confirmation.':'Votre application courriel s’ouvrira avec votre message à Patricia.';
    $('#contact-fallback').hidden=isAppointment;
  }
  setContactMode('appointment');
  modeTabs.forEach(tab=>tab.addEventListener('click',()=>setContactMode(tab.dataset.contactMode)));
  $('[role="tablist"]').addEventListener('keydown',event=>{
    const current=modeTabs.indexOf(document.activeElement);if(current<0)return;
    let next=current;
    if(event.key==='ArrowRight'||event.key==='ArrowDown')next=(current+1)%modeTabs.length;
    else if(event.key==='ArrowLeft'||event.key==='ArrowUp')next=(current+modeTabs.length-1)%modeTabs.length;
    else if(event.key==='Home')next=0;
    else if(event.key==='End')next=modeTabs.length-1;else return;
    event.preventDefault();modeTabs[next].focus();setContactMode(modeTabs[next].dataset.contactMode);
  });
  document.querySelectorAll('a[data-contact-mode]').forEach(link=>link.addEventListener('click',()=>setContactMode(link.dataset.contactMode)));

  contactForm.addEventListener('submit',async event=>{
    event.preventDefault();
    if(contactMode==='appointment'&&(!appointmentDate.value||!bookingTime.value)){
      calendarStatus.textContent='Choisissez une date et une heure disponibles.';
      return;
    }
    if(!contactForm.reportValidity())return;
    const fields=contactForm.elements,status=$('#appointment-status');
    if(contactMode==='appointment'){
      submitButton.disabled=true;submitNote.textContent='Envoi de la demande…';
      try{
        const response=await fetch(bookingApi+'/api/public/appointments',{method:'POST',credentials:'omit',headers:{'content-type':'application/json'},body:JSON.stringify({
          firstName:fields.firstName.value,lastName:fields.lastName.value,email:fields.email.value,phone:fields.phone.value,
          service:fields.service.value,date:appointmentDate.value,time:bookingTime.value,location:fields.location.value,message:fields.notes.value
        })});
        const result=await response.json();
        if(!response.ok)throw new Error(result.error==='SLOT_OCCUPIED'?'Ce créneau vient d’être réservé. Choisissez une autre heure.':'La demande n’a pas pu être transmise. Veuillez réessayer.');
        status.textContent='Votre demande a été reçue. Elle est en attente de confirmation par Patricia.';
        status.classList.remove('error');contactForm.reset();selectedDay='';appointmentDate.value='';$('#slot-field').hidden=true;detailsPanel.hidden=true;setContactMode('appointment');loadPublicCalendar();
      }catch(error){status.textContent=error.message;status.classList.add('error');}
      finally{submitButton.disabled=false;submitNote.textContent='Patricia confirmera le rendez-vous selon ses disponibilités.';}
      return;
    }
    const fullName=[fields.messageFirstName.value,fields.messageLastName.value].join(' ');
    const subject=encodeURIComponent('Demande d’information — '+fullName);
    const body=encodeURIComponent(`Bonjour Patricia,\n\nNom : ${fullName}\nCourriel : ${fields.messageEmail.value.trim()}\n\n${fields.message.value.trim()}\n\nMerci !`);
    status.textContent='Votre application courriel va s’ouvrir. Vérifiez le message puis envoyez-le.';
    window.location.href='mailto:patricialanctot@hotmail.com?subject='+subject+'&body='+body;
  });
  $('#privacy-link').addEventListener('click',event=>{
    event.preventDefault();
    $('#appointment-status').textContent='Les coordonnées saisies pour une demande de rendez-vous sont utilisées pour traiter celle-ci. Un message classique reste transmis par votre application courriel.';
    contactForm.scrollIntoView({behavior:'smooth',block:'center'});
  });
  const onvioLink=$('#onvio-link'),onvioUrl=window.PATRICIA_SITE_CONFIG?.onvioUrl?.trim()||'';
  try{const parsed=new URL(onvioUrl);if(parsed.protocol==='https:'){onvioLink.href=parsed.href;onvioLink.hidden=false;}}catch{}
})();
