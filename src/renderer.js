const { desktopCapturer } = require('electron');
const { OpenAI } = require('openai');
const axios = require('axios');

// Config: Defaults
let TRIGGER_WORDS = ['Lance Munyao']; 
let NTFY_TOPIC = 'my-meeting-alerts';
let transcriptBuffer = '';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'your-key-here';
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

let mediaStream;
let audioContext;
let scriptProcessor;
let recorder;

// Load saved settings on start
function loadSettings() {
  const savedTriggers = localStorage.getItem('triggers');
  const savedTopic = localStorage.getItem('ntfyTopic');
  if (savedTriggers) {
    TRIGGER_WORDS = savedTriggers.split(',').map(word => word.trim().toLowerCase());
    document.getElementById('triggers').value = savedTriggers;
  }
  if (savedTopic) {
    NTFY_TOPIC = savedTopic;
    document.getElementById('ntfy-topic').value = savedTopic;
  }
}

// Save settings
document.getElementById('save-settings').addEventListener('click', () => {
  const triggersInput = document.getElementById('triggers').value;
  const topicInput = document.getElementById('ntfy-topic').value;
  if (triggersInput) {
    TRIGGER_WORDS = triggersInput.split(',').map(word => word.trim().toLowerCase());
    localStorage.setItem('triggers', triggersInput);
  }
  if (topicInput) {
    NTFY_TOPIC = topicInput;
    localStorage.setItem('ntfyTopic', topicInput);
  }
  document.getElementById('status').innerText = 'Status: Settings saved!';
});

async function startCapture() {
  if (TRIGGER_WORDS.length === 0 || TRIGGER_WORDS[0] === '') {
    document.getElementById('status').innerText = 'Status: Please enter trigger words first.';
    return;
  }
  try {
    document.getElementById('status').innerText = 'Status: Initializing capture...';
    const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
    const teamsSource = sources.find(source => source.name.includes('Teams'));
    if (!teamsSource) {
      document.getElementById('status').innerText = 'Status: Open Microsoft Teams and try again.';
      console.error('No Teams window found');
      return;
    }

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: teamsSource.id,
        },
      },
      video: false,
    });

    audioContext = new AudioContext({ sampleRate: 16000 });
    const source = audioContext.createMediaStreamSource(mediaStream);
    scriptProcessor = audioContext.createScriptProcessor(1024, 1, 1);
    source.connect(scriptProcessor);
    scriptProcessor.connect(audioContext.destination);

    recorder = new MediaRecorder(mediaStream, { mimeType: 'audio/webm' });
    const audioChunks = [];

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunks.push(event.data);
    };

    recorder.onstop = async () => {
      if (audioChunks.length === 0) {
        console.warn('No audio data captured');
        return;
      }
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      audioChunks.length = 0;

      const formData = new FormData();
      formData.append('file', audioBlob, 'audio.webm');
      formData.append('model', 'whisper-1');

      try {
        const transcription = await openai.audio.transcriptions.create({
          file: formData.get('file'),
          model: 'whisper-1',
        });
        const text = transcription.text;
        transcriptBuffer += text + ' ';
        document.getElementById('status').innerText = `Status: Transcribed: ${text.slice(0, 50)}...`;
        console.log('Transcription:', text);
        await processTranscript(text);
      } catch (err) {
        console.error('Transcription error:', err.message);
        document.getElementById('status').innerText = `Status: Transcription error: ${err.message}`;
      }
    };

    recorder.start();
    document.getElementById('status').innerText = 'Status: Recording...';
    document.getElementById('start').disabled = true;
    document.getElementById('stop').disabled = false;
    setInterval(() => {
      if (recorder.state === 'recording') {
        recorder.stop();
        recorder.start();
      }
    }, 5000);
  } catch (err) {
    console.error('Capture error:', err.message);
    document.getElementById('status').innerText = `Status: Error starting capture: ${err.message}`;
  }
}

async function processTranscript(newText) {
  const lowerText = newText.toLowerCase();
  const detected = TRIGGER_WORDS.some(word => lowerText.includes(word));
  if (detected) {
    console.log('Trigger detected in transcript:', newText);
    const contextWindow = transcriptBuffer.slice(-500);
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Analyze if this is calling the user for attendance or a question. Extract key details.' },
          { role: 'user', content: `Transcript: ${contextWindow}` },
        ],
        max_tokens: 100,
      });
      const summary = response.choices[0].message.content;
      console.log('Analysis:', summary);
      sendNotification(`Trigger detected! Context: ${summary}`);
      transcriptBuffer = '';
    } catch (err) {
      console.error('Analysis error:', err.message);
      document.getElementById('status').innerText = `Status: Analysis error: ${err.message}`;
    }
  }
}

function sendNotification(message) {
  axios
    .post(`https://ntfy.sh/${NTFY_TOPIC}`, message, {
      headers: { Title: 'Meeting Alert' },
    })
    .then(() => console.log('Notification sent:', message))
    .catch((err) => {
      console.error('Notification failed:', err.message);
      document.getElementById('status').innerText = `Status: Notification error: ${err.message}`;
    });
}

function stopCapture() {
  if (recorder && recorder.state === 'recording') recorder.stop();
  if (mediaStream) mediaStream.getTracks().forEach(track => track.stop());
  if (audioContext) audioContext.close();
  document.getElementById('status').innerText = 'Status: Stopped';
  document.getElementById('start').disabled = false;
  document.getElementById('stop').disabled = true;
}

// Initialize
loadSettings();
document.getElementById('start').addEventListener('click', startCapture);
document.getElementById('stop').addEventListener('click', stopCapture);
document.getElementById('stop').disabled = true;