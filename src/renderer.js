const { desktopCapturer } = require('electron');
const { OpenAI } = require('openai');
const axios = require('axios');

// Config: Replace with your details
const USER_NAME = 'Your Full Name'; // e.g., 'John Doe'
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'your-key-here'; // Set in .env
const NTFY_TOPIC = 'my-meeting-alerts'; // Your ntfy topic
let transcriptBuffer = ''; // Sliding window for context (last ~30 seconds)

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

let mediaStream;
let audioContext;
let scriptProcessor;
let recorder;

async function startCapture() {
  try {
    // Get available sources
    const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
    const teamsSource = sources.find(source => source.name.includes('Teams'));
    if (!teamsSource) {
      document.getElementById('status').innerText = 'Status: Open Microsoft Teams and try again.';
      return;
    }

    // Get audio stream
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: teamsSource.id,
        },
      },
      video: false,
    });

    // Set up AudioContext and MediaRecorder
    audioContext = new AudioContext({ sampleRate: 16000 });
    const source = audioContext.createMediaStreamSource(mediaStream);
    scriptProcessor = audioContext.createScriptProcessor(1024, 1, 1);
    source.connect(scriptProcessor);
    scriptProcessor.connect(audioContext.destination);

    // Use MediaRecorder for audio chunks
    recorder = new MediaRecorder(mediaStream, { mimeType: 'audio/webm' });
    const audioChunks = [];

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunks.push(event.data);
    };

    // Process audio every 5 seconds
    recorder.onstop = async () => {
      if (audioChunks.length === 0) return;
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      audioChunks.length = 0; // Clear chunks

      // Transcribe with Whisper
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
        document.getElementById('status').innerText = `Status: Transcribed: ${text}`;
        await processTranscript(text);
      } catch (err) {
        console.error('Transcription error:', err);
        document.getElementById('status').innerText = `Status: Error transcribing`;
      }
    };

    // Start recording and process periodically
    recorder.start();
    setInterval(() => {
      if (recorder.state === 'recording') {
        recorder.stop();
        recorder.start();
      }
    }, 5000); // 5-second chunks for transcription

  } catch (err) {
    console.error('Capture error:', err);
    document.getElementById('status').innerText = `Status: Error starting capture`;
  }
}

async function processTranscript(newText) {
  if (newText.toLowerCase().includes(USER_NAME.toLowerCase())) {
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
      sendNotification(`Name called! Context: ${summary}`);
      transcriptBuffer = ''; // Clear buffer after alert
    } catch (err) {
      console.error('Analysis error:', err);
    }
  }
}

function sendNotification(message) {
  axios
    .post(`https://ntfy.sh/${NTFY_TOPIC}`, message, {
      headers: { Title: 'Meeting Alert' },
    })
    .catch((err) => console.error('Notification failed:', err));
}

// Start capture on button click
document.getElementById('start').addEventListener('click', startCapture);