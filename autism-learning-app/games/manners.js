// Manners & Behaviors (Social Stories) Module

import { audioService, speechService, celebrate } from '../app.js';

// SVG drawing templates for social story scenes
const storyAssets = {
  share_start: `<svg viewBox="0 0 120 120">
    <!-- Playground background -->
    <rect x="10" y="80" width="100" height="30" rx="8" fill="#C8E6C9"/>
    <!-- Kids blocks / toys -->
    <rect x="50" y="70" width="20" height="20" rx="4" fill="#FF8A80"/>
    <rect x="55" y="52" width="10" height="18" rx="2" fill="#80D8FF"/>
    <circle cx="50" cy="78" r="8" fill="#FFE082"/>
    <!-- Timmy looking at toy -->
    <circle cx="35" cy="40" r="12" fill="#FFCC80"/>
    <path d="M25 60 C25 50 45 50 45 60 Z" fill="#42A5F5"/>
    <circle cx="33" cy="38" r="1.5" fill="#3E2723"/>
    <circle cx="37" cy="38" r="1.5" fill="#3E2723"/>
    <path d="M32 45 Q35 48 38 45" fill="none" stroke="#3E2723" stroke-width="1.5"/>
    <!-- Sally standing nearby -->
    <circle cx="85" cy="42" r="12" fill="#FFE082"/>
    <path d="M75 62 C75 52 95 52 95 62 Z" fill="#AB47BC"/>
    <circle cx="82" cy="40" r="1.5" fill="#3E2723"/>
    <circle cx="86" cy="40" r="1.5" fill="#3E2723"/>
    <path d="M81 47 Q85 45 89 47" fill="none" stroke="#3E2723" stroke-width="1.5"/>
  </svg>`,
  share_polite: `<svg viewBox="0 0 120 120">
    <rect x="10" y="80" width="100" height="30" rx="8" fill="#C8E6C9"/>
    <!-- Sharing toys together -->
    <rect x="42" y="74" width="16" height="16" rx="4" fill="#FF8A80"/>
    <rect x="62" y="74" width="16" height="16" rx="4" fill="#80D8FF"/>
    <!-- Two kids happy & holding hands -->
    <circle cx="35" cy="40" r="12" fill="#FFCC80"/>
    <path d="M25 60 C25 50 45 50 45 60 Z" fill="#42A5F5"/>
    <!-- Happy faces -->
    <circle cx="33" cy="38" r="1.5" fill="#3E2723"/>
    <circle cx="37" cy="38" r="1.5" fill="#3E2723"/>
    <path d="M31 43 Q35 48 39 43" fill="none" stroke="#3E2723" stroke-width="2"/>
    
    <circle cx="85" cy="40" r="12" fill="#FFE082"/>
    <path d="M75 60 C75 50 95 50 95 60 Z" fill="#AB47BC"/>
    <circle cx="83" cy="38" r="1.5" fill="#3E2723"/>
    <circle cx="87" cy="38" r="1.5" fill="#3E2723"/>
    <path d="M81 43 Q85 48 89 43" fill="none" stroke="#3E2723" stroke-width="2"/>
    <!-- Sparkles/Hearts -->
    <path d="M60 25 L62 30 L67 30 L63 33 L65 38 L60 35 L55 38 L57 33 L53 30 L58 30 Z" fill="#FFE082"/>
  </svg>`,
  greet_start: `<svg viewBox="0 0 120 120">
    <!-- School corridor/wall -->
    <rect x="10" y="10" width="100" height="90" fill="#E0F7FA" opacity="0.5"/>
    <!-- Two characters far apart -->
    <circle cx="30" cy="45" r="12" fill="#FFCC80"/>
    <path d="M20 65 C20 55 40 55 40 65 Z" fill="#66BB6A"/>
    <!-- Friend Leo waving -->
    <circle cx="90" cy="45" r="12" fill="#FFE082"/>
    <path d="M80 65 C80 55 100 55 100 65 Z" fill="#FFA726"/>
    <!-- Leo's waving arm -->
    <path d="M96 52 Q108 42 104 38" fill="none" stroke="#FFA726" stroke-width="4" stroke-linecap="round"/>
  </svg>`,
  greet_happy: `<svg viewBox="0 0 120 120">
    <circle cx="35" cy="45" r="12" fill="#FFCC80"/>
    <path d="M25 65 C25 55 45 55 45 65 Z" fill="#66BB6A"/>
    <!-- Waving hand -->
    <path d="M28 52 Q16 42 20 38" fill="none" stroke="#FFCC80" stroke-width="4" stroke-linecap="round"/>

    <circle cx="85" cy="45" r="12" fill="#FFE082"/>
    <path d="M75 65 C75 55 95 55 95 65 Z" fill="#FFA726"/>
    <!-- Leo waving hand -->
    <path d="M92 52 Q104 42 100 38" fill="none" stroke="#FFE082" stroke-width="4" stroke-linecap="round"/>
    
    <!-- Speech bubbles -->
    <rect x="10" y="15" width="40" height="18" rx="8" fill="#FFFFFF" stroke="#66BB6A" stroke-width="2"/>
    <text x="17" y="27" font-size="10" font-family="'Fredoka', sans-serif" fill="#2E7D32">Hi Amit!</text>
    <rect x="70" y="15" width="40" height="18" rx="8" fill="#FFFFFF" stroke="#FFA726" stroke-width="2"/>
    <text x="76" y="27" font-size="10" font-family="'Fredoka', sans-serif" fill="#E65100">Hello!</text>
  </svg>`,
  wash_dirty: `<svg viewBox="0 0 120 120">
    <!-- Two dirty hands -->
    <path d="M35 80 L35 45 C35 38 48 38 48 45 L48 80" fill="none" stroke="#D7CCC8" stroke-width="8" stroke-linecap="round"/>
    <path d="M28 80 L28 50 C28 45 35 45 35 50" fill="none" stroke="#D7CCC8" stroke-width="6" stroke-linecap="round"/>
    <path d="M42 80 L42 50 C42 45 48 45 48 50" fill="none" stroke="#D7CCC8" stroke-width="6" stroke-linecap="round"/>
    <!-- Germ spots -->
    <circle cx="30" cy="55" r="2.5" fill="#4CAF50"/>
    <circle cx="44" cy="42" r="3" fill="#81C784"/>
    <circle cx="35" cy="65" r="2" fill="#388E3C"/>
  </svg>`,
  wash_clean: `<svg viewBox="0 0 120 120">
    <!-- Sink with tap running -->
    <path d="M20 90 L100 90 L90 110 L30 110 Z" fill="#CFD8DC" stroke="#90A4AE" stroke-width="3"/>
    <path d="M60 40 L60 70" fill="none" stroke="#80D8FF" stroke-width="8" stroke-linecap="round"/>
    <!-- Sparkly clean hands -->
    <path d="M42 85 L42 65 C42 60 52 60 52 65 L52 85" fill="none" stroke="#FFE082" stroke-width="6" stroke-linecap="round"/>
    <!-- Water ripples/bubbles -->
    <circle cx="50" cy="75" r="4" fill="#00B0FF" opacity="0.7"/>
    <circle cx="68" cy="80" r="3" fill="#00B0FF" opacity="0.7"/>
    <!-- Sparkles -->
    <polygon points="76 46 78 50 82 50 79 53 80 57 76 55 72 57 73 53 70 50 74 50" fill="#FFF59D"/>
  </svg>`
};

const storyData = [
  {
    id: 'sharing',
    title: 'Sharing Blocks with Priya',
    description: 'Help Rohan decide how to share blocks.',
    thumbnail: storyAssets.share_start,
    slides: [
      {
        text: 'Rohan is playing with a stack of blocks. Priya walks up and wants to play with the blocks too.',
        svg: storyAssets.share_start,
        options: [
          {
            text: 'Grab all the blocks and run away.',
            feedback: 'Oh, running away makes Priya sad. Grabbing is not sharing. Let\'s try another option!',
            isCorrect: false
          },
          {
            text: 'Smile and say: "Would you like to build blocks together?"',
            feedback: 'Wonderful! Priya feels happy. Building together is double the fun!',
            isCorrect: true
          }
        ]
      },
      {
        text: 'Rohan shares the blocks. Priya says "Thank you!" and they build a giant castle together.',
        svg: storyAssets.share_polite,
        options: [] // End slide
      }
    ]
  },
  {
    id: 'greeting',
    title: 'Greeting Friend Amit',
    description: 'Learn how to say hello at school.',
    thumbnail: storyAssets.greet_start,
    slides: [
      {
        text: 'You see your classmate Amit in the classroom. Amit waves at you from across the room.',
        svg: storyAssets.greet_start,
        options: [
          {
            text: 'Look down and ignore Amit.',
            feedback: 'Amit might feel lonely or think you are angry. Let\'s try to wave back!',
            isCorrect: false
          },
          {
            text: 'Wave your hand, smile, and say: "Hi Amit!"',
            feedback: 'Perfect! Amit smiles and waves back. It is friendly to greet friends!',
            isCorrect: true
          }
        ]
      },
      {
        text: 'Both friends are happy and greeting each other. A great start to a fun school day!',
        svg: storyAssets.greet_happy,
        options: []
      }
    ]
  },
  {
    id: 'wash_hands',
    title: 'Washing Hands Before Lunch',
    description: 'Wash away germs before we eat.',
    thumbnail: storyAssets.wash_dirty,
    slides: [
      {
        text: 'It is dinner time! Our hands look clean, but they have invisible little germs from playing outdoors.',
        svg: storyAssets.wash_dirty,
        options: [
          {
            text: 'Sit at the table and eat dinner right away.',
            feedback: 'Oh no! Germs on hands can get on our food and make us sick. Let\'s wash them first!',
            isCorrect: false
          },
          {
            text: 'Go to the sink and wash hands with soap and water.',
            feedback: 'Fantastic! Washing hands keeps germs away and keeps our bodies healthy!',
            isCorrect: true
          }
        ]
      },
      {
        text: 'Splish splash! All the germs are washed down the sink. Clean hands are ready for yummy food!',
        svg: storyAssets.wash_clean,
        options: []
      }
    ]
  }
];

let activeStory = null;
let currentSlideIndex = 0;

export function initManners() {
  renderStorySelector();
  
  // Back logic inside story player
  document.getElementById('btn-story-next').addEventListener('click', () => {
    goToNextSlide();
  });
}

function renderStorySelector() {
  const container = document.getElementById('manners-story-selector');
  const player = document.getElementById('manners-story-player');
  
  container.classList.remove('hidden');
  player.classList.add('hidden');
  
  container.innerHTML = '';

  storyData.forEach(story => {
    const card = document.createElement('div');
    card.className = 'story-card';

    const thumb = document.createElement('div');
    thumb.className = 'story-card-thumb';
    thumb.innerHTML = story.thumbnail;

    const title = document.createElement('h3');
    title.textContent = story.title;

    const desc = document.createElement('p');
    desc.textContent = story.description;

    card.appendChild(thumb);
    card.appendChild(title);
    card.appendChild(desc);

    card.addEventListener('click', () => {
      audioService.playPop();
      startStory(story);
    });

    container.appendChild(card);
  });
}

function startStory(story) {
  activeStory = story;
  currentSlideIndex = 0;

  document.getElementById('manners-story-selector').classList.add('hidden');
  document.getElementById('manners-story-player').classList.remove('hidden');

  loadSlide();
}

function loadSlide() {
  if (!activeStory) return;
  const slide = activeStory.slides[currentSlideIndex];
  
  // Progress bar updates
  const progressPercent = ((currentSlideIndex + 1) / activeStory.slides.length) * 100;
  document.getElementById('story-progress-fill').style.width = `${progressPercent}%`;

  // Draw slide illustration
  document.getElementById('story-slide-image-container').innerHTML = slide.svg;

  // Text details
  document.getElementById('story-text').textContent = slide.text;
  
  // Announce the story slide voice
  speechService.speak(slide.text);

  // Clear options and feedbacks
  const optionsContainer = document.getElementById('story-options-container');
  const feedbackEl = document.getElementById('story-feedback');
  
  optionsContainer.innerHTML = '';
  feedbackEl.classList.add('hidden');

  // If slide has options to select
  if (slide.options && slide.options.length > 0) {
    document.getElementById('btn-story-next').classList.add('hidden');
    
    slide.options.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'btn btn-option';
      btn.textContent = opt.text;
      
      btn.addEventListener('click', () => {
        handleOptionClick(opt);
      });
      
      optionsContainer.appendChild(btn);
    });
  } else {
    // End slide with no decisions, just Next button
    const nextBtn = document.getElementById('btn-story-next');
    nextBtn.classList.remove('hidden');
    nextBtn.textContent = (currentSlideIndex === activeStory.slides.length - 1) ? 'Finish Story!' : 'Next';
  }
}

function handleOptionClick(option) {
  const feedbackEl = document.getElementById('story-feedback');
  const feedbackMsg = document.getElementById('story-feedback-msg');
  const nextBtn = document.getElementById('btn-story-next');

  feedbackMsg.textContent = option.feedback;
  speechService.speak(option.feedback);
  feedbackEl.classList.remove('hidden');

  if (option.isCorrect) {
    audioService.playSuccess();
    feedbackEl.style.borderLeftColor = 'var(--color-cooking-primary)';
    
    // Hide option buttons to enforce going forward
    document.getElementById('story-options-container').innerHTML = '';
    
    nextBtn.classList.remove('hidden');
    nextBtn.textContent = 'Awesome! Continue';
  } else {
    audioService.playOops();
    feedbackEl.style.borderLeftColor = 'var(--color-manners-primary)';
  }
}

function goToNextSlide() {
  audioService.playPop();

  if (currentSlideIndex + 1 < activeStory.slides.length) {
    currentSlideIndex++;
    loadSlide();
  } else {
    // Story Completed! Celebrate!
    celebrate(`You finished the story: "${activeStory.title}"! Good choice maker!`, () => {
      renderStorySelector();
    });
  }
}
