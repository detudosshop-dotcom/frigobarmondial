/* Captura e persiste parametros de rastreamento (UTMs) para envio a Utmify. */
(function(){
  var KEYS=['src','sck','utm_source','utm_campaign','utm_medium','utm_content','utm_term','utm_id'];
  var STORE='LV_UTM';
  function read(){ try{ return JSON.parse(localStorage.getItem(STORE)||'{}')||{}; }catch(e){ return {}; } }
  function save(o){ try{ localStorage.setItem(STORE, JSON.stringify(o)); }catch(e){} }
  var saved=read();
  try{
    var q=new URLSearchParams(location.search), found=false, fresh={};
    KEYS.forEach(function(k){ var v=q.get(k); if(v){ fresh[k]=String(v).slice(0,200); found=true; } });
    if(found){ saved=fresh; save(saved); }
  }catch(e){}
  window.LV_UTM={ get:function(){ var o=read(); return Object.keys(o).length?o:null; } };
})();

/* Atribuicao Meta Ads: garante que o clique no anuncio (fbclid) seja
   preservado em todo o funil, mesmo que o pixel carregue depois da
   navegacao. Grava o cookie _fbc no formato oficial da Meta. */
(function(){
  try{
    var q=new URLSearchParams(location.search);
    var clid=q.get('fbclid');
    if(clid){ try{ localStorage.setItem('LV_FBCLID', clid); }catch(e){} }
    if(!clid){ try{ clid=localStorage.getItem('LV_FBCLID')||''; }catch(e){} }
    var hasFbc=/(^|;\s*)_fbc=/.test(document.cookie);
    if(clid && !hasFbc){
      var host=location.hostname.replace(/^www\./,'');
      document.cookie='_fbc=fb.1.'+Date.now()+'.'+clid+'; path=/; max-age=7776000; domain=.'+host+'; SameSite=Lax';
    }
  }catch(e){}
})();

/* Dados de atribuicao do Meta (cookies _fbp/_fbc + URL) enviados ao servidor
   para que o Purchase da API de Conversoes seja creditado ao anuncio certo. */
(function(){
  function cookie(name){
    try{
      var m=document.cookie.match(new RegExp('(^|;\\s*)'+name+'=([^;]*)'));
      return m?decodeURIComponent(m[2]):'';
    }catch(e){ return ''; }
  }
  window.LV_FB={ get:function(){
    var fbc=cookie('_fbc');
    if(!fbc){ try{ var c=localStorage.getItem('LV_FBCLID'); if(c) fbc='fb.1.'+Date.now()+'.'+c; }catch(e){} }
    return { fbp: cookie('_fbp')||null, fbc: fbc||null, url: location.href.slice(0,500) };
  }};
})();
