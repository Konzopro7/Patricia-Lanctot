    const header=document.querySelector('.site-header');
    const menu=document.querySelector('.menu-toggle');
    const nav=document.querySelector('.main-nav');
    const setHeader=()=>header.classList.toggle('scrolled',window.scrollY>12);
    setHeader();window.addEventListener('scroll',setHeader,{passive:true});
    menu.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));menu.setAttribute('aria-label',open?'Fermer le menu':'Ouvrir le menu');nav.classList.toggle('open',open)});
    nav.querySelectorAll('a').forEach(link=>link.addEventListener('click',()=>{nav.classList.remove('open');menu.setAttribute('aria-expanded','false');menu.setAttribute('aria-label','Ouvrir le menu')}));
    const serviceIntros={
      'D\u00e9claration d\u2019imp\u00f4ts':'ma d\u00e9claration d\u2019imp\u00f4ts',
      'Tenue de livres':'la tenue de mes livres comptables',
      'Rapports de taxes':'mes d\u00e9clarations de TPS/TVQ',
      'Revenus locatifs / gains en capital':'mes revenus locatifs ou mes gains en capital',
      'Travailleur autonome':'mes besoins comptables et fiscaux comme travailleur autonome',
      'Autre':'une situation particuli\u00e8re'
    };
    const serviceSelect=document.querySelector('#service');
    const messageField=document.querySelector('#message');
    function prefillServiceMessage(service){
      const subject=serviceIntros[service];
      if(!subject)return;
      const oldText=messageField.value.trim();
      const details=oldText.replace(/^Bonjour Patricia,\s*\n\s*\nJe souhaite obtenir de l.aide concernant [^\n]*\.\s*/i,'').trim();
      messageField.value=`Bonjour Patricia,\n\nJe souhaite obtenir de l\u2019aide concernant ${subject}.\n\n${details||'Ma situation : '}`;
    }
    document.querySelectorAll('.service-action').forEach(link=>link.addEventListener('click',event=>{
      event.preventDefault();
      serviceSelect.value=link.dataset.service;
      prefillServiceMessage(serviceSelect.value);
      history.replaceState(null,'','#contact');
      messageField.scrollIntoView({behavior:'smooth',block:'center'});
      if(window.matchMedia('(min-width: 700px)').matches){window.setTimeout(()=>{messageField.focus({preventScroll:true});messageField.setSelectionRange(messageField.value.length,messageField.value.length)},450)}
    }));
    serviceSelect.addEventListener('change',()=>prefillServiceMessage(serviceSelect.value));
    const revealItems=document.querySelectorAll('[data-reveal]');
    if('IntersectionObserver' in window&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('visible');observer.unobserve(entry.target)}}),{threshold:.12,rootMargin:'0px 0px -30px 0px'});revealItems.forEach(item=>observer.observe(item))}else revealItems.forEach(item=>item.classList.add('visible'));
    document.querySelector('#contact-form').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;const status=document.querySelector('#form-status');if(!form.reportValidity())return;if(form.elements.website.value){status.textContent='';return}status.textContent='Merci. Le formulaire est prêt à être relié à un service d’envoi. Pour le moment, veuillez nous joindre par téléphone ou par courriel.';form.reset()});
    document.querySelector('#newsletter-form').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;if(!form.reportValidity())return;const email=form.elements.email.value.trim();const subject=encodeURIComponent('Inscription \u00e0 l\u2019infolettre');const body=encodeURIComponent(`Bonjour Patricia,\n\nJe souhaite m\u2019inscrire \u00e0 votre infolettre.\n\nMon adresse courriel : ${email}\n\nMerci !`);document.querySelector('#newsletter-status').textContent='Votre application courriel va s\u2019ouvrir avec une demande d\u2019inscription pr\u00e9remplie.';window.location.href=`mailto:Patricialanctot@hotmail.com?subject=${subject}&body=${body}`});
    document.querySelector('#privacy-link').addEventListener('click',event=>{event.preventDefault();document.querySelector('#form-status').textContent='Les renseignements transmis par courriel ou formulaire doivent être utilisés uniquement pour répondre à votre demande. Aucun backend de collecte n’est actuellement configuré.';document.querySelector('#contact-form').scrollIntoView({behavior:'smooth',block:'center'})});

  const cookieBanner=document.querySelector('#cookie-banner');
  const cookieAccept=document.querySelector('#cookie-accept');
  const cookieReject=document.querySelector('#cookie-reject');
  const mapFrame=document.querySelector('#google-map');
  const consentName='patricia_maps_consent';
  const consentPath=window.location.pathname.startsWith('/Patricia-Lanctot/')?'/Patricia-Lanctot/':'/';
  function readCookie(name){return document.cookie.split('; ').find(item=>item.startsWith(`${name}=`))?.split('=')[1]||''}
  function activateMap(){
    if(!mapFrame||mapFrame.querySelector('iframe'))return;
    const iframe=document.createElement('iframe');
    iframe.src=mapFrame.dataset.mapSrc;
    iframe.title='Google Maps - 12 chemin des Lucioles, Saint-Hippolyte';
    iframe.width='600';iframe.height='450';iframe.loading='lazy';iframe.allowFullscreen=true;
    iframe.referrerPolicy='strict-origin-when-cross-origin';
    mapFrame.replaceChildren(iframe);
  }
  function saveMapChoice(choice){
    document.cookie=`${consentName}=${choice}; Max-Age=31536000; Path=${consentPath}; SameSite=Lax; Secure`;
    cookieBanner.hidden=true;
    if(choice==='accepted')activateMap();
  }
  const existingChoice=readCookie(consentName);
  if(existingChoice==='accepted'){cookieBanner.hidden=true;activateMap()}
  else if(existingChoice==='rejected')cookieBanner.hidden=true;
  cookieAccept.addEventListener('click',()=>saveMapChoice('accepted'));
  cookieReject.addEventListener('click',()=>saveMapChoice('rejected'));
  document.querySelector('#map-activate').addEventListener('click',()=>saveMapChoice('accepted'));
  document.querySelectorAll('#cookie-settings').forEach(link=>link.addEventListener('click',event=>{
    event.preventDefault();cookieBanner.hidden=false;cookieAccept.focus({preventScroll:true});
  }));
