'use strict';

(function () {
  const SUPPORTED = ['en', 'es', 'de', 'ru', 'pt', 'fr', 'pl'];

  const TRANSLATIONS = {
    en: {
      tagline:      'Private video calls, anywhere',
      joinCall:     'Join Call',
      waiting:      'Waiting for others to join\u2026',
      shareLink:    'Share this link:',
      connecting:   'Connecting\u2026',
      reconnecting: 'Reconnecting\u2026',
      connected:    'Connected',
      connError:    'Connection error',
      inCall:       n => `Connected \u00b7 ${n} in call`,
      leave:        'Leave',
      muteAudio:    'Mute mic',
      muteVideo:    'Turn off camera',
      leaveCall:    'Leave call',
      errPermission:'Camera/mic permission required to join.',
      errNotFound:  'No camera or microphone found on this device.',
      errInUse:     'Camera/mic is in use by another app.',
      errGeneric:   msg => `Could not access camera/mic: ${msg}`,
    },

    es: {
      tagline:      'Videollamadas privadas, en cualquier lugar',
      joinCall:     'Unirse',
      waiting:      'Esperando que otros se unan\u2026',
      shareLink:    'Comparte este enlace:',
      connecting:   'Conectando\u2026',
      reconnecting: 'Reconectando\u2026',
      connected:    'Conectado',
      connError:    'Error de conexi\u00f3n',
      inCall:       n => `Conectado \u00b7 ${n} en llamada`,
      leave:        'Salir',
      muteAudio:    'Silenciar micr\u00f3fono',
      muteVideo:    'Apagar c\u00e1mara',
      leaveCall:    'Salir de la llamada',
      errPermission:'Se requiere permiso de c\u00e1mara/micr\u00f3fono para unirse.',
      errNotFound:  'No se encontr\u00f3 c\u00e1mara ni micr\u00f3fono en este dispositivo.',
      errInUse:     'La c\u00e1mara/micr\u00f3fono est\u00e1 en uso por otra aplicaci\u00f3n.',
      errGeneric:   msg => `No se pudo acceder a la c\u00e1mara/micr\u00f3fono: ${msg}`,
    },

    de: {
      tagline:      'Private Videoanrufe, \u00fcberall',
      joinCall:     'Beitreten',
      waiting:      'Warten auf andere Teilnehmer\u2026',
      shareLink:    'Link teilen:',
      connecting:   'Verbinde\u2026',
      reconnecting: 'Verbinde erneut\u2026',
      connected:    'Verbunden',
      connError:    'Verbindungsfehler',
      inCall:       n => `Verbunden \u00b7 ${n} im Gespr\u00e4ch`,
      leave:        'Verlassen',
      muteAudio:    'Mikrofon stummschalten',
      muteVideo:    'Kamera ausschalten',
      leaveCall:    'Anruf verlassen',
      errPermission:'Kamera-/Mikrofonberechtigung erforderlich.',
      errNotFound:  'Keine Kamera oder Mikrofon auf diesem Ger\u00e4t gefunden.',
      errInUse:     'Kamera/Mikrofon wird von einer anderen App verwendet.',
      errGeneric:   msg => `Kein Zugriff auf Kamera/Mikrofon: ${msg}`,
    },

    ru: {
      tagline:      '\u041f\u0440\u0438\u0432\u0430\u0442\u043d\u044b\u0435 \u0432\u0438\u0434\u0435\u043e\u0437\u0432\u043e\u043d\u043a\u0438, \u0433\u0434\u0435 \u0443\u0433\u043e\u0434\u043d\u043e',
      joinCall:     '\u0412\u043e\u0439\u0442\u0438',
      waiting:      '\u041e\u0436\u0438\u0434\u0430\u043d\u0438\u0435 \u0434\u0440\u0443\u0433\u0438\u0445 \u0443\u0447\u0430\u0441\u0442\u043d\u0438\u043a\u043e\u0432\u2026',
      shareLink:    '\u041f\u043e\u0434\u0435\u043b\u0438\u0442\u0435\u0441\u044c \u0441\u0441\u044b\u043b\u043a\u043e\u0439:',
      connecting:   '\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435\u2026',
      reconnecting: '\u041f\u0435\u0440\u0435\u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435\u2026',
      connected:    '\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u043e',
      connError:    '\u041e\u0448\u0438\u0431\u043a\u0430 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u044f',
      inCall:       n => `\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u043e \u00b7 ${n} \u0432 \u0437\u0432\u043e\u043d\u043a\u0435`,
      leave:        '\u0412\u044b\u0439\u0442\u0438',
      muteAudio:    '\u0412\u044b\u043a\u043b\u044e\u0447\u0438\u0442\u044c \u043c\u0438\u043a\u0440\u043e\u0444\u043e\u043d',
      muteVideo:    '\u0412\u044b\u043a\u043b\u044e\u0447\u0438\u0442\u044c \u043a\u0430\u043c\u0435\u0440\u0443',
      leaveCall:    '\u041f\u043e\u043a\u0438\u043d\u0443\u0442\u044c \u0437\u0432\u043e\u043d\u043e\u043a',
      errPermission:'\u0414\u043b\u044f \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u044f \u043d\u0435\u043e\u0431\u0445\u043e\u0434\u0438\u043c\u043e \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043d\u0438\u0435 \u043d\u0430 \u043a\u0430\u043c\u0435\u0440\u0443/\u043c\u0438\u043a\u0440\u043e\u0444\u043e\u043d.',
      errNotFound:  '\u041a\u0430\u043c\u0435\u0440\u0430 \u0438\u043b\u0438 \u043c\u0438\u043a\u0440\u043e\u0444\u043e\u043d \u043d\u0435 \u043e\u0431\u043d\u0430\u0440\u0443\u0436\u0435\u043d\u044b \u043d\u0430 \u044d\u0442\u043e\u043c \u0443\u0441\u0442\u0440\u043e\u0439\u0441\u0442\u0432\u0435.',
      errInUse:     '\u041a\u0430\u043c\u0435\u0440\u0430/\u043c\u0438\u043a\u0440\u043e\u0444\u043e\u043d \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u044e\u0442\u0441\u044f \u0434\u0440\u0443\u0433\u0438\u043c \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435\u043c.',
      errGeneric:   msg => `\u041d\u0435\u0442 \u0434\u043e\u0441\u0442\u0443\u043f\u0430 \u043a \u043a\u0430\u043c\u0435\u0440\u0435/\u043c\u0438\u043a\u0440\u043e\u0444\u043e\u043d\u0443: ${msg}`,
    },

    pt: {
      tagline:      'Videochamadas privadas, em qualquer lugar',
      joinCall:     'Entrar',
      waiting:      'Aguardando outros participantes\u2026',
      shareLink:    'Compartilhe este link:',
      connecting:   'Conectando\u2026',
      reconnecting: 'Reconectando\u2026',
      connected:    'Conectado',
      connError:    'Erro de conex\u00e3o',
      inCall:       n => `Conectado \u00b7 ${n} na chamada`,
      leave:        'Sair',
      muteAudio:    'Silenciar microfone',
      muteVideo:    'Desligar c\u00e2mera',
      leaveCall:    'Sair da chamada',
      errPermission:'Permiss\u00e3o de c\u00e2mera/microfone necess\u00e1ria para entrar.',
      errNotFound:  'Nenhuma c\u00e2mera ou microfone encontrado neste dispositivo.',
      errInUse:     'C\u00e2mera/microfone em uso por outro aplicativo.',
      errGeneric:   msg => `N\u00e3o foi poss\u00edvel acessar c\u00e2mera/microfone: ${msg}`,
    },

    fr: {
      tagline:      'Appels vid\u00e9o priv\u00e9s, o\u00f9 que vous soyez',
      joinCall:     'Rejoindre',
      waiting:      'En attente des autres participants\u2026',
      shareLink:    'Partagez ce lien\u00a0:',
      connecting:   'Connexion\u2026',
      reconnecting: 'Reconnexion\u2026',
      connected:    'Connect\u00e9',
      connError:    'Erreur de connexion',
      inCall:       n => `Connect\u00e9 \u00b7 ${n} dans l\u2019appel`,
      leave:        'Quitter',
      muteAudio:    'Couper le micro',
      muteVideo:    '\u00c9teindre la cam\u00e9ra',
      leaveCall:    'Quitter l\u2019appel',
      errPermission:'Permission cam\u00e9ra/micro requise pour rejoindre.',
      errNotFound:  'Aucune cam\u00e9ra ni microphone trouv\u00e9 sur cet appareil.',
      errInUse:     'Cam\u00e9ra/micro utilis\u00e9 par une autre application.',
      errGeneric:   msg => `Impossible d\u2019acc\u00e9der \u00e0 la cam\u00e9ra/micro\u00a0: ${msg}`,
    },

    pl: {
      tagline:      'Prywatne rozmowy wideo, gdziekolwiek jeste\u015b',
      joinCall:     'Do\u0142\u0105cz',
      waiting:      'Oczekiwanie na innych uczestnik\u00f3w\u2026',
      shareLink:    'Udost\u0119pnij ten link:',
      connecting:   '\u0141\u0105czenie\u2026',
      reconnecting: 'Ponowne \u0142\u0105czenie\u2026',
      connected:    'Po\u0142\u0105czono',
      connError:    'B\u0142\u0105d po\u0142\u0105czenia',
      inCall:       n => `Po\u0142\u0105czono \u00b7 ${n} na rozmowie`,
      leave:        'Wyj\u0064\u017a',
      muteAudio:    'Wycisz mikrofon',
      muteVideo:    'Wy\u0142\u0105cz kamer\u0119',
      leaveCall:    'Opu\u015b\u0107 rozmow\u0119',
      errPermission:'Wymagane uprawnienia do kamery/mikrofonu.',
      errNotFound:  'Nie znaleziono kamery ani mikrofonu na tym urz\u0105dzeniu.',
      errInUse:     'Kamera/mikrofon s\u0105 u\u017cywane przez inn\u0105 aplikacj\u0119.',
      errGeneric:   msg => `Nie mo\u017cna uzyska\u0107 dost\u0119pu do kamery/mikrofonu: ${msg}`,
    },
  };

  // Detect browser language, fall back to English
  const browserLang = ((navigator.languages && navigator.languages[0]) || navigator.language || 'en')
    .slice(0, 2).toLowerCase();
  const locale = SUPPORTED.includes(browserLang) ? browserLang : 'en';
  const lang = TRANSLATIONS[locale];

  // Set HTML lang attribute for accessibility
  document.documentElement.lang = locale;

  // Global translation function
  window.t = function (key, ...args) {
    const val = lang[key] !== undefined ? lang[key] : TRANSLATIONS.en[key];
    return typeof val === 'function' ? val(...args) : (val !== undefined ? val : key);
  };

  // Apply translations to static DOM elements immediately
  function applyAll() {
    const tagline = document.querySelector('.tagline');
    if (tagline) tagline.textContent = window.t('tagline');

    const btnJoin = document.getElementById('btn-join');
    if (btnJoin) btnJoin.textContent = window.t('joinCall');

    const waitingSpan = document.querySelector('#waiting-msg span');
    if (waitingSpan) waitingSpan.textContent = window.t('waiting');

    const shareLabel = document.getElementById('share-link-label');
    if (shareLabel) shareLabel.textContent = window.t('shareLink');

    const btnLeave = document.getElementById('btn-leave');
    if (btnLeave) {
      btnLeave.textContent = window.t('leave');
      btnLeave.title = window.t('leaveCall');
    }

    const btnMuteAudio = document.getElementById('btn-mute-audio');
    if (btnMuteAudio) btnMuteAudio.title = window.t('muteAudio');

    const btnMuteVideo = document.getElementById('btn-mute-video');
    if (btnMuteVideo) btnMuteVideo.title = window.t('muteVideo');
  }

  applyAll();
}());
