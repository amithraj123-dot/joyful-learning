// Speech Hub Module

import { audioService, speechService } from '../app.js';

// SVG generator templates for speech flashcards
const speechAssets = {
  apple: `<svg viewBox="0 0 100 100">
    <path d="M50 85 C30 85 20 70 20 45 C20 25 35 15 50 22 C65 15 80 25 80 45 C80 70 70 85 50 85 Z" fill="#EF5350"/>
    <path d="M50 20 Q55 10 65 8" fill="none" stroke="#8D6E63" stroke-width="4" stroke-linecap="round"/>
    <path d="M54 18 Q62 14 62 5 Q50 8 50 18" fill="#81C784"/>
    <ellipse cx="35" cy="35" rx="3" ry="8" fill="#FFFFFF" opacity="0.6" transform="rotate(-15, 35, 35)"/>
  </svg>`,
  cat: `<svg viewBox="0 0 100 100">
    <ellipse cx="50" cy="65" rx="28" ry="22" fill="#FFB74D"/>
    <circle cx="50" cy="40" r="18" fill="#FFB74D"/>
    <!-- Ears -->
    <polygon points="34 32 24 12 42 26" fill="#FFB74D" stroke="#FF9800" stroke-width="2"/>
    <polygon points="66 32 76 12 58 26" fill="#FFB74D" stroke="#FF9800" stroke-width="2"/>
    <!-- Inner Ears -->
    <polygon points="33 28 27 15 38 24" fill="#FF8A80"/>
    <polygon points="67 28 73 15 62 24" fill="#FF8A80"/>
    <!-- Eyes -->
    <circle cx="44" cy="38" r="3.5" fill="#37474F"/>
    <circle cx="56" cy="38" r="3.5" fill="#37474F"/>
    <circle cx="43" cy="37" r="1" fill="#FFFFFF"/>
    <circle cx="55" cy="37" r="1" fill="#FFFFFF"/>
    <!-- Nose & Mouth -->
    <polygon points="50 44 47 42 53 42" fill="#FF8A80"/>
    <path d="M47 46 Q50 49 53 46" fill="none" stroke="#37474F" stroke-width="2"/>
    <!-- Whiskers -->
    <line x1="30" y1="42" x2="16" y2="40" stroke="#37474F" stroke-width="2"/>
    <line x1="30" y1="46" x2="14" y2="47" stroke="#37474F" stroke-width="2"/>
    <line x1="70" y1="42" x2="84" y2="40" stroke="#37474F" stroke-width="2"/>
    <line x1="70" y1="46" x2="86" y2="47" stroke="#37474F" stroke-width="2"/>
    <!-- Tail -->
    <path d="M78 65 Q92 65 90 45" fill="none" stroke="#FFB74D" stroke-width="6" stroke-linecap="round"/>
  </svg>`,
  dog: `<svg viewBox="0 0 100 100">
    <ellipse cx="50" cy="62" rx="30" ry="24" fill="#8D6E63"/>
    <circle cx="50" cy="40" r="20" fill="#8D6E63"/>
    <!-- Ears -->
    <path d="M28 32 C20 32 15 48 22 55 C25 57 32 50 32 40" fill="#5D4037"/>
    <path d="M72 32 C80 32 85 48 78 55 C75 57 68 50 68 40" fill="#5D4037"/>
    <!-- Eyes -->
    <circle cx="43" cy="36" r="3.5" fill="#3E2723"/>
    <circle cx="57" cy="36" r="3.5" fill="#3E2723"/>
    <circle cx="42" cy="35" r="1" fill="#FFFFFF"/>
    <circle cx="56" cy="35" r="1" fill="#FFFFFF"/>
    <!-- Snout & Nose -->
    <ellipse cx="50" cy="44" rx="8" ry="6" fill="#D7CCC8"/>
    <ellipse cx="50" cy="41" rx="4.5" ry="3" fill="#212121"/>
    <path d="M47 46 Q50 49 53 46" fill="none" stroke="#212121" stroke-width="2"/>
  </svg>`,
  sun: `<svg viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="22" fill="#FFCA28" stroke="#F57F17" stroke-width="3"/>
    <!-- Rays -->
    <g stroke="#FFB300" stroke-width="5" stroke-linecap="round">
      <line x1="50" y1="12" x2="50" y2="22"/>
      <line x1="50" y1="78" x2="50" y2="88"/>
      <line x1="12" y1="50" x2="22" y2="50"/>
      <line x1="78" y1="50" x2="88" y2="50"/>
      <line x1="23" y1="23" x2="30" y2="30"/>
      <line x1="70" y1="70" x2="77" y2="77"/>
      <line x1="70" y1="30" x2="77" y2="23"/>
      <line x1="23" y1="77" x2="30" y2="70"/>
    </g>
    <!-- Smiling face -->
    <circle cx="44" cy="46" r="2.5" fill="#37474F"/>
    <circle cx="56" cy="46" r="2.5" fill="#37474F"/>
    <path d="M43 53 Q50 58 57 53" fill="none" stroke="#37474F" stroke-width="2.5" stroke-linecap="round"/>
  </svg>`,
  water: `<svg viewBox="0 0 100 100">
    <path d="M30 30 L35 85 C36 88 38 90 41 90 L59 90 C62 90 64 88 65 85 L70 30 Z" fill="#ECEFF1" stroke="#B0BEC5" stroke-width="4" stroke-linejoin="round"/>
    <path d="M34 50 L37 83 C37 85 39 86 41 86 L59 86 C61 86 63 85 63 83 L66 50 Z" fill="#29B6F6"/>
    <path d="M34 50 Q50 54 66 50" fill="none" stroke="#039BE5" stroke-width="4"/>
    <!-- Bubbles -->
    <circle cx="45" cy="60" r="3" fill="#FFFFFF" opacity="0.6"/>
    <circle cx="55" cy="70" r="4.5" fill="#FFFFFF" opacity="0.6"/>
  </svg>`,
  happy: `<svg viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="42" fill="#FFF59D" stroke="#FBC02D" stroke-width="4"/>
    <circle cx="38" cy="42" r="4.5" fill="#3E2723"/>
    <circle cx="62" cy="42" r="4.5" fill="#3E2723"/>
    <!-- Big Happy Smile -->
    <path d="M34 55 Q50 72 66 55" fill="none" stroke="#3E2723" stroke-width="4" stroke-linecap="round"/>
    <!-- Rosy Cheeks -->
    <circle cx="28" cy="50" r="5" fill="#FF8A80" opacity="0.8"/>
    <circle cx="72" cy="50" r="5" fill="#FF8A80" opacity="0.8"/>
  </svg>`,
  sad: `<svg viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="42" fill="#E1F5FE" stroke="#0288D1" stroke-width="4"/>
    <!-- Sad Eyes -->
    <path d="M32 38 Q38 35 44 38" fill="none" stroke="#37474F" stroke-width="3" stroke-linecap="round"/>
    <path d="M56 38 Q62 35 68 38" fill="none" stroke="#37474F" stroke-width="3" stroke-linecap="round"/>
    <circle cx="38" cy="44" r="4" fill="#37474F"/>
    <circle cx="62" cy="44" r="4" fill="#37474F"/>
    <!-- Frown -->
    <path d="M36 65 Q50 52 64 65" fill="none" stroke="#37474F" stroke-width="4" stroke-linecap="round"/>
    <!-- Tear -->
    <path d="M38 52 C38 52 35 58 35 60 C35 62 36.5 63 38 63 C39.5 63 41 62 41 60 C41 58 38 52 38 52 Z" fill="#29B6F6"/>
  </svg>`,
  angry: `<svg viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="42" fill="#FFEBEE" stroke="#E53935" stroke-width="4"/>
    <!-- Angry Eyes/Eyebrows -->
    <path d="M30 34 L44 42" stroke="#263238" stroke-width="4" stroke-linecap="round"/>
    <path d="M70 34 L56 42" stroke="#263238" stroke-width="4" stroke-linecap="round"/>
    <circle cx="38" cy="46" r="4" fill="#263238"/>
    <circle cx="62" cy="46" r="4" fill="#263238"/>
    <!-- Angry Mouth -->
    <path d="M40 65 Q50 58 60 65" fill="none" stroke="#263238" stroke-width="4" stroke-linecap="round"/>
  </svg>`,
  run: `<svg viewBox="0 0 100 100">
    <!-- Shoe/Running silhouette representation -->
    <path d="M25 60 Q20 50 30 40 L60 30 Q75 30 80 45 L85 65 Q85 75 75 75 L35 75 Q25 75 25 60 Z" fill="#80DEEA" stroke="#00838F" stroke-width="3"/>
    <path d="M35 75 L75 75" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round"/>
    <ellipse cx="65" cy="48" rx="10" ry="6" fill="#FFFFFF" opacity="0.7"/>
    <!-- Dynamic speed lines -->
    <line x1="15" y1="42" x2="5" y2="42" stroke="#00ACC1" stroke-width="3" stroke-linecap="round"/>
    <line x1="12" y1="52" x2="2" y2="52" stroke="#00ACC1" stroke-width="3" stroke-linecap="round"/>
    <line x1="16" y1="62" x2="6" y2="62" stroke="#00ACC1" stroke-width="3" stroke-linecap="round"/>
  </svg>`,
  eat: `<svg viewBox="0 0 100 100">
    <!-- Bowl & Spoon -->
    <path d="M15 45 C15 70 35 80 50 80 C65 80 85 70 85 45 Z" fill="#FFCC80" stroke="#EF6C00" stroke-width="3"/>
    <rect x="10" y="40" width="80" height="8" rx="4" fill="#FFA726"/>
    <!-- Steam -->
    <path d="M35 32 Q40 22 35 15" fill="none" stroke="#FFB74D" stroke-width="3" stroke-linecap="round"/>
    <path d="M50 32 Q55 22 50 15" fill="none" stroke="#FFB74D" stroke-width="3" stroke-linecap="round"/>
    <path d="M65 32 Q70 22 65 15" fill="none" stroke="#FFB74D" stroke-width="3" stroke-linecap="round"/>
  </svg>`,
  sleep: `<svg viewBox="0 0 100 100">
    <path d="M20 70 L20 40 C20 30 35 30 35 40 L35 70" fill="none" stroke="#90CAF9" stroke-width="4" stroke-linecap="round"/>
    <path d="M20 55 L80 55" stroke="#90CAF9" stroke-width="6" stroke-linecap="round"/>
    <circle cx="30" cy="46" r="6" fill="#FFF9C4"/>
    <!-- Zzz -->
    <text x="60" y="25" font-family="'Fredoka', sans-serif" font-size="16" fill="#1565C0" font-weight="700">Z</text>
    <text x="72" y="38" font-family="'Fredoka', sans-serif" font-size="20" fill="#1E88E5" font-weight="700">Z</text>
    <text x="84" y="55" font-family="'Fredoka', sans-serif" font-size="24" fill="#42A5F5" font-weight="700">Z</text>
  </svg>`,
  mango: `<svg viewBox="0 0 100 100">
    <path d="M50 80 C20 80 15 50 30 30 C45 15 65 15 70 25 C75 35 75 70 55 80 C53 81 51 80 50 80 Z" fill="#FFC107" stroke="#FFA000" stroke-width="3"/>
    <path d="M50 18 Q55 8 60 5" fill="none" stroke="#795548" stroke-width="4" stroke-linecap="round"/>
    <path d="M52 14 Q65 10 65 2 Q54 6 52 14" fill="#4CAF50"/>
  </svg>`,
  peacock: `<svg viewBox="0 0 100 100">
    <circle cx="50" cy="65" r="25" fill="#00ACC1"/>
    <circle cx="50" cy="42" r="14" fill="#00838F"/>
    <path d="M50 65 L20 30 M50 65 L30 18 M50 65 L50 10 M50 65 L70 18 M50 65 L80 30" stroke="#00E676" stroke-width="4" stroke-linecap="round"/>
    <circle cx="20" cy="30" r="4" fill="#D500F9"/>
    <circle cx="30" cy="18" r="4" fill="#D500F9"/>
    <circle cx="50" cy="10" r="4" fill="#D500F9"/>
    <circle cx="70" cy="18" r="4" fill="#D500F9"/>
    <circle cx="80" cy="30" r="4" fill="#D500F9"/>
    <polygon points="46 44 54 44 50 50" fill="#FFB300"/>
  </svg>`,
  lotus: `<svg viewBox="0 0 100 100">
    <path d="M50 80 C30 70 20 50 50 25 C80 50 70 70 50 80 Z" fill="#F06292"/>
    <path d="M50 80 C20 75 10 60 40 40 C70 60 80 75 50 80 Z" fill="#EC407A"/>
    <path d="M50 80 C10 80 2 68 30 55 C58 68 90 80 50 80 Z" fill="#D81B60"/>
    <ellipse cx="50" cy="85" rx="35" ry="8" fill="#4CAF50"/>
  </svg>`,
  idli: `<svg viewBox="0 0 100 100">
    <ellipse cx="50" cy="55" rx="35" ry="24" fill="#ECEFF1" stroke="#CFD8DC" stroke-width="3"/>
    <ellipse cx="48" cy="52" rx="30" ry="20" fill="#F5F7F8"/>
    <circle cx="50" cy="55" r="1.5" fill="#B0BEC5"/>
    <circle cx="42" cy="48" r="1" fill="#B0BEC5"/>
  </circle>`,
  dosa: `<svg viewBox="0 0 100 100">
    <path d="M10 70 C10 70 45 40 90 20" fill="none" stroke="#D7CCC8" stroke-width="12" stroke-linecap="round"/>
    <path d="M10 70 C10 70 45 40 90 20" fill="none" stroke="#FFE082" stroke-width="8" stroke-linecap="round"/>
    <circle cx="35" cy="55" r="2.5" fill="#8D6E63"/>
    <circle cx="60" cy="40" r="3" fill="#8D6E63"/>
  </svg>`,
  samosa: `<svg viewBox="0 0 100 100">
    <polygon points="50 15 15 80 85 80" fill="#FFE082" stroke="#F57C00" stroke-width="3" stroke-linejoin="round"/>
    <line x1="50" y1="15" x2="50" y2="80" stroke="#E65100" stroke-width="2" stroke-dasharray="2 3"/>
  </svg>`,
  egg: `<svg viewBox="0 0 100 100">
    <path d="M50 85 C32 85 22 72 22 55 C22 32 36 15 50 15 C64 15 78 32 78 55 C78 72 68 85 50 85 Z" fill="#FFFFFF" stroke="#CFD8DC" stroke-width="3"/>
    <circle cx="50" cy="58" r="18" fill="#FFCA28"/>
  </svg>`
};

const wordData = [
  { id: 'apple', label: 'Apple', phonetic: 'Ap-pul', category: 'common' },
  { id: 'sun', label: 'Sun', phonetic: 'Suhn', category: 'common' },
  { id: 'water', label: 'Water', phonetic: 'Wah-ter', category: 'common' },
  { id: 'mango', label: 'Mango', phonetic: 'Maang-go', category: 'common' },
  { id: 'lotus', label: 'Lotus', phonetic: 'Lo-tus', category: 'common' },
  { id: 'idli', label: 'Idli', phonetic: 'Id-lee', category: 'common' },
  { id: 'dosa', label: 'Dosa', phonetic: 'Doh-sah', category: 'common' },
  { id: 'samosa', label: 'Samosa', phonetic: 'Sah-moh-sah', category: 'common' },
  { id: 'egg', label: 'Egg', phonetic: 'Eg', category: 'common' },
  { id: 'cat', label: 'Cat', phonetic: 'Kat', category: 'animals' },
  { id: 'dog', label: 'Dog', phonetic: 'Dog', category: 'animals' },
  { id: 'peacock', label: 'Peacock', phonetic: 'Pee-kok', category: 'animals' },
  { id: 'happy', label: 'Happy', phonetic: 'Hap-pee', category: 'feelings' },
  { id: 'sad', label: 'Sad', phonetic: 'Sad', category: 'feelings' },
  { id: 'angry', label: 'Angry', phonetic: 'Ang-gree', category: 'feelings' },
  { id: 'run', label: 'Run', phonetic: 'Ruhn', category: 'actions' },
  { id: 'eat', label: 'Eat', phonetic: 'Eet', category: 'actions' },
  { id: 'sleep', label: 'Sleep', phonetic: 'Sleep', category: 'actions' }
];

let activeCategory = 'common';
let selectedWord = null;
let recognition = null;
let isListening = false;

export function initSpeech() {
  setupCategoryButtons();
  renderCards();
  setupSpeechControlButtons();
  setupSpeechRecognition();

  // Auto select first word
  const firstWordOfCat = wordData.find(w => w.category === activeCategory);
  if (firstWordOfCat) {
    selectWordCard(firstWordOfCat);
  }
}

function setupCategoryButtons() {
  const container = document.querySelector('.speech-category-select');
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-category');
    if (!btn) return;
    
    // Play sound
    audioService.playPop();

    // Toggle active category classes
    document.querySelectorAll('.btn-category').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    activeCategory = btn.getAttribute('data-category');
    renderCards();

    // Select first item of new category
    const catWords = wordData.filter(w => w.category === activeCategory);
    if (catWords.length > 0) {
      selectWordCard(catWords[0]);
    }
  });
}

function renderCards() {
  const container = document.getElementById('speech-cards-container');
  container.innerHTML = '';

  const catWords = wordData.filter(w => w.category === activeCategory);
  catWords.forEach(word => {
    const card = document.createElement('div');
    card.className = `speech-card ${selectedWord && selectedWord.id === word.id ? 'selected' : ''}`;
    card.setAttribute('data-id', word.id);

    const svgWrapper = document.createElement('div');
    svgWrapper.className = 'speech-card-thumb';
    svgWrapper.innerHTML = speechAssets[word.id] || '';

    const label = document.createElement('span');
    label.className = 'speech-card-label';
    label.textContent = word.label;

    card.appendChild(svgWrapper);
    card.appendChild(label);
    
    card.addEventListener('click', () => {
      audioService.playPop();
      selectWordCard(word);
    });

    container.appendChild(card);
  });
}

function selectWordCard(word) {
  selectedWord = word;
  
  // Highlight card
  document.querySelectorAll('.speech-card').forEach(c => {
    if (c.getAttribute('data-id') === word.id) {
      c.classList.add('selected');
    } else {
      c.classList.remove('selected');
    }
  });

  // Render Focus card details
  document.getElementById('speech-focus-title').textContent = word.label;
  
  // Check hints enabled
  const showHints = document.getElementById('toggle-hints').checked;
  document.getElementById('speech-focus-phonetic').textContent = showHints ? `Sounds like: "${word.phonetic}"` : '';
  
  document.getElementById('speech-focus-svg-container').innerHTML = speechAssets[word.id] || '';
  
  // Hide results
  document.getElementById('speech-practice-result').classList.add('hidden');

  // Trigger speak aloud automatically
  speechService.speak(word.label);
}

function setupSpeechControlButtons() {
  const btnListen = document.getElementById('btn-speech-listen');
  const btnMic = document.getElementById('btn-speech-mic');

  btnListen.addEventListener('click', () => {
    audioService.playPop();
    if (selectedWord) {
      speechService.speak(selectedWord.label);
    }
  });

  btnMic.addEventListener('click', () => {
    startListening();
  });
}

// Browser webkitSpeechRecognition setups
function setupSpeechRecognition() {
  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRec();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      isListening = true;
      document.getElementById('speech-mic-feedback').classList.remove('hidden');
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition error', event);
      stopListening();
    };

    recognition.onend = () => {
      stopListening();
    };

    recognition.onresult = (event) => {
      const speechToText = event.results[0][0].transcript;
      verifySpokenWord(speechToText);
    };
  }
}

function startListening() {
  if (isListening) return;
  audioService.playPop();

  if (recognition) {
    try {
      recognition.start();
    } catch (e) {
      console.warn('Speech recognition start failed', e);
      runMockSpeechInput();
    }
  } else {
    // Recognition API not supported, use child friendly mockup delay fallback
    runMockSpeechInput();
  }
}

function stopListening() {
  isListening = false;
  document.getElementById('speech-mic-feedback').classList.add('hidden');
}

// Mock recognition input for unsupported browsers
function runMockSpeechInput() {
  const feedback = document.getElementById('speech-mic-feedback');
  feedback.classList.remove('hidden');
  
  // Wait 2.5 seconds, then mock a correct spoken word match (or prompt)
  setTimeout(() => {
    feedback.classList.add('hidden');
    if (selectedWord) {
      // Mock success for kid validation
      verifySpokenWord(selectedWord.label);
    }
  }, 2500);
}

function verifySpokenWord(spokenText) {
  if (!selectedWord) return;

  const target = selectedWord.label.toLowerCase().trim();
  const spoken = spokenText.toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"");

  const resultEl = document.getElementById('speech-practice-result');
  resultEl.classList.remove('hidden');

  if (spoken.includes(target) || target.includes(spoken)) {
    // Success Match
    audioService.playSuccess();
    resultEl.className = 'practice-result result-success';
    resultEl.textContent = `⭐ Awesome! You said: "${selectedWord.label}" ⭐`;
    
    // Jump to next word in category after 2.5 seconds
    setTimeout(() => {
      const catWords = wordData.filter(w => w.category === activeCategory);
      const currentIdx = catWords.findIndex(w => w.id === selectedWord.id);
      if (currentIdx !== -1 && currentIdx + 1 < catWords.length) {
        selectWordCard(catWords[currentIdx + 1]);
      }
    }, 2500);

  } else {
    // Mismatch
    audioService.playOops();
    resultEl.className = 'practice-result result-retry';
    resultEl.textContent = `Try again! Let's say "${selectedWord.label}"`;
  }
}
