// Main Application Controller

import { initSpeech } from './games/speech.js';
import { initManners } from './games/manners.js';
import { initSorting } from './games/sorting.js';
import { initCooking } from './games/cooking.js';
import { initFindMatch } from './games/findmatch.js';

// Global Game Settings
export const gameSettings = {
  difficulty: 'medium', // 'easy', 'medium', 'hard'
  getDifficultyChoicesCount() {
    if (this.difficulty === 'easy') return 2;
    if (this.difficulty === 'hard') return 6;
    return 4; // 'medium'
  }
};

// Web Audio API Synthesizer class
class AudioService {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.7;
  }
  
  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playPop() {
    if (this.muted) return;
    this.init();
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(350, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(700, this.ctx.currentTime + 0.1);
      
      gain.gain.setValueAtTime(this.volume * 0.4, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.1);
    } catch (e) {
      console.warn('Audio play failed', e);
    }
  }

  playSuccess() {
    if (this.muted) return;
    this.init();
    try {
      const now = this.ctx.currentTime;
      // Rising major arpeggio
      const notes = [261.63, 329.63, 392.00, 523.25]; // C4, E4, G4, C5
      notes.forEach((freq, index) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + index * 0.08);
        
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(this.volume * 0.3, now + index * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.01, now + index * 0.08 + 0.25);
        
        osc.start(now + index * 0.08);
        osc.stop(now + index * 0.08 + 0.25);
      });
    } catch (e) {
      console.warn('Audio play failed', e);
    }
  }

  playOops() {
    if (this.muted) return;
    this.init();
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, this.ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(160, this.ctx.currentTime + 0.2);
      
      gain.gain.setValueAtTime(this.volume * 0.3, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.2);
    } catch (e) {
      console.warn('Audio play failed', e);
    }
  }
}

export const audioService = new AudioService();

// Speech Synthesis Service wrapper
export const speechService = {
  voices: [],
  selectedVoice: null,
  rate: 0.9,
  volume: 0.7,

  init() {
    if (!('speechSynthesis' in window)) return;
    
    const loadVoices = () => {
      this.voices = window.speechSynthesis.getVoices();
      const voiceSelect = document.getElementById('select-voice');
      if (voiceSelect) {
        voiceSelect.innerHTML = '<option value="default">Default System Voice</option>';
        let enInVoiceIndex = -1;
        
        this.voices.forEach((voice, index) => {
          if (voice.lang.includes('en') || voice.lang.includes('EN')) {
            const opt = document.createElement('option');
            opt.value = index;
            opt.textContent = `${voice.name} (${voice.lang})`;
            
            // Check for Indian English voice
            if (voice.lang.toLowerCase().includes('en-in') || voice.name.toLowerCase().includes('india')) {
              if (enInVoiceIndex === -1) {
                enInVoiceIndex = index;
              }
            }
            voiceSelect.appendChild(opt);
          }
        });
        
        // Auto-select Indian English Voice as default if found
        if (enInVoiceIndex !== -1) {
          voiceSelect.value = enInVoiceIndex;
          this.selectedVoice = this.voices[enInVoiceIndex];
          console.log("Auto-selected Indian English Voice:", this.selectedVoice.name);
        }
      }
    };
    
    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  },

  speak(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    if (this.selectedVoice) {
      utter.voice = this.selectedVoice;
    }
    utter.rate = this.rate;
    utter.volume = this.volume;
    window.speechSynthesis.speak(utter);
  }
};

// Application State Routing
const AppRouter = {
  activeView: 'dashboard',
  history: [],

  navigate(viewId) {
    // Play button tap audio
    audioService.playPop();

    // Hide all views
    const views = document.querySelectorAll('.app-view');
    views.forEach(v => v.classList.remove('active'));

    // Show selected view
    const activeViewEl = document.getElementById(`view-${viewId}`);
    if (activeViewEl) {
      activeViewEl.classList.add('active');
      this.activeView = viewId;

      // Handle logo & back button visibility
      const btnBack = document.getElementById('btn-back');
      if (viewId === 'dashboard') {
        btnBack.classList.add('hidden');
      } else {
        btnBack.classList.remove('hidden');
      }

      // Initialize the specific module
      this.initModule(viewId);
    }
  },

  initModule(viewId) {
    switch (viewId) {
      case 'speech':
        initSpeech();
        break;
      case 'manners':
        initManners();
        break;
      case 'sorting':
        initSorting();
        break;
      case 'cooking':
        initCooking();
        break;
      case 'findmatch':
        initFindMatch();
        break;
    }
  }
};

// Adult Gate Lock for parental settings
let mathAnswer = 0;
function setupAdultGate() {
  const num1 = Math.floor(Math.random() * 8) + 5; // 5 to 12
  const num2 = Math.floor(Math.random() * 8) + 4; // 4 to 11
  mathAnswer = num1 + num2;

  document.getElementById('math-num1').textContent = num1;
  document.getElementById('math-num2').textContent = num2;
  document.getElementById('gate-answer').value = '';
  document.getElementById('gate-error-msg').classList.add('hidden');

  document.getElementById('adult-gate').classList.remove('hidden');
  document.getElementById('settings-panel').classList.add('hidden');
}

// Global Progress and Celebration controller
export function celebrate(message, onContinueCallback) {
  audioService.playSuccess();
  const layer = document.getElementById('celebration-layer');
  const msgEl = document.getElementById('celebration-message');
  msgEl.textContent = message || 'Super job, you did it!';
  layer.classList.remove('hidden');

  const btnCont = document.getElementById('btn-celebration-continue');
  // Remove existing listeners by clone
  const newBtn = btnCont.cloneNode(true);
  btnCont.parentNode.replaceChild(newBtn, btnCont);
  
  newBtn.addEventListener('click', () => {
    audioService.playPop();
    layer.classList.add('hidden');
    if (onContinueCallback) onContinueCallback();
  });
}

// Setup Event Listeners and Initialize
document.addEventListener('DOMContentLoaded', () => {
  // Init Services
  speechService.init();

  // Navigation events
  document.getElementById('btn-home-logo').addEventListener('click', () => {
    AppRouter.navigate('dashboard');
  });
  
  document.getElementById('btn-back').addEventListener('click', () => {
    AppRouter.navigate('dashboard');
  });

  // Game menu cards
  const menuCards = document.querySelectorAll('.menu-card');
  menuCards.forEach(card => {
    card.addEventListener('click', () => {
      const gameKey = card.getAttribute('data-game');
      AppRouter.navigate(gameKey);
    });
  });

  // Mute button control
  const btnMute = document.getElementById('btn-mute');
  const iconOn = document.getElementById('icon-sound-on');
  const iconOff = document.getElementById('icon-sound-off');
  
  btnMute.addEventListener('click', () => {
    audioService.muted = !audioService.muted;
    if (audioService.muted) {
      iconOn.classList.add('hidden');
      iconOff.classList.remove('hidden');
    } else {
      iconOn.classList.remove('hidden');
      iconOff.classList.add('hidden');
      audioService.playPop();
    }
  });

  // Modal Settings open/close
  const settingsModal = document.getElementById('settings-modal');
  document.getElementById('btn-settings').addEventListener('click', () => {
    audioService.playPop();
    setupAdultGate();
    settingsModal.classList.remove('hidden');
  });

  document.getElementById('btn-gate-close').addEventListener('click', () => {
    audioService.playPop();
    settingsModal.classList.add('hidden');
  });

  // Math Gate Verification
  document.getElementById('btn-gate-submit').addEventListener('click', () => {
    const userVal = parseInt(document.getElementById('gate-answer').value, 10);
    if (userVal === mathAnswer) {
      audioService.playSuccess();
      document.getElementById('adult-gate').classList.add('hidden');
      document.getElementById('settings-panel').classList.remove('hidden');
    } else {
      audioService.playOops();
      document.getElementById('gate-error-msg').classList.remove('hidden');
      setupAdultGate();
    }
  });

  // Handle settings controls inputs
  const selectVoice = document.getElementById('select-voice');
  selectVoice.addEventListener('change', () => {
    const selectedIdx = selectVoice.value;
    if (selectedIdx === 'default') {
      speechService.selectedVoice = null;
    } else {
      speechService.selectedVoice = speechService.voices[parseInt(selectedIdx, 10)];
    }
    speechService.speak('Voice check! How is this?');
  });

  const sliderSpeed = document.getElementById('slider-speed');
  sliderSpeed.addEventListener('input', () => {
    const val = parseFloat(sliderSpeed.value);
    document.getElementById('speed-val').textContent = val.toFixed(1);
    speechService.rate = val;
  });

  const sliderVolume = document.getElementById('slider-volume');
  sliderVolume.addEventListener('input', () => {
    const val = parseFloat(sliderVolume.value);
    speechService.volume = val;
    audioService.volume = val;
  });

  const toggleHighContrast = document.getElementById('toggle-high-contrast');
  toggleHighContrast.addEventListener('change', () => {
    if (toggleHighContrast.checked) {
      document.body.classList.add('high-contrast-mode');
    } else {
      document.body.classList.remove('high-contrast-mode');
    }
  });

  // Difficulty Level selector radios
  const diffRadios = document.querySelectorAll('input[name="difficulty"]');
  diffRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.checked) {
        gameSettings.difficulty = radio.value;
        audioService.playPop();
        console.log("Difficulty Level changed to:", gameSettings.difficulty);
      }
    });
  });

  // Close Settings panel
  document.getElementById('btn-settings-close').addEventListener('click', () => {
    audioService.playPop();
    settingsModal.classList.add('hidden');
  });

  document.getElementById('btn-settings-reset-data').addEventListener('click', () => {
    audioService.playPop();
    localStorage.clear();
    alert('Game progress has been reset!');
    settingsModal.classList.add('hidden');
    window.location.reload();
  });
});
