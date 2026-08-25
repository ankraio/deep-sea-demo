const canvas = document.getElementById("ocean");
const drawingContext = canvas.getContext("2d");
const factText = document.getElementById("fact-text");
const factCounter = document.getElementById("fact-counter");
const nextFactButton = document.getElementById("next-fact");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatLog = document.getElementById("chat-log");

const conversationHistory = [];
let facts = [];
let factIndex = 0;

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function createParticles(count) {
  return Array.from({ length: count }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    radius: 0.6 + Math.random() * 2.2,
    driftX: (Math.random() - 0.5) * 0.25,
    driftY: -(0.08 + Math.random() * 0.35),
    pulseOffset: Math.random() * Math.PI * 2,
    hue: 170 + Math.random() * 40,
  }));
}

const particles = createParticles(140);

function drawOcean(timestamp) {
  drawingContext.clearRect(0, 0, canvas.width, canvas.height);
  for (const particle of particles) {
    particle.x += particle.driftX;
    particle.y += particle.driftY;
    if (particle.y < -10) {
      particle.y = canvas.height + 10;
      particle.x = Math.random() * canvas.width;
    }
    if (particle.x < -10) particle.x = canvas.width + 10;
    if (particle.x > canvas.width + 10) particle.x = -10;

    const pulse = 0.35 + 0.3 * Math.sin(timestamp / 900 + particle.pulseOffset);
    const glow = drawingContext.createRadialGradient(
      particle.x,
      particle.y,
      0,
      particle.x,
      particle.y,
      particle.radius * 6,
    );
    glow.addColorStop(0, `hsla(${particle.hue}, 85%, 70%, ${pulse})`);
    glow.addColorStop(1, "hsla(190, 85%, 70%, 0)");
    drawingContext.fillStyle = glow;
    drawingContext.beginPath();
    drawingContext.arc(particle.x, particle.y, particle.radius * 6, 0, Math.PI * 2);
    drawingContext.fill();
  }
  window.requestAnimationFrame(drawOcean);
}

function showFact() {
  if (facts.length === 0) return;
  factText.textContent = facts[factIndex];
  factCounter.textContent = `${factIndex + 1} of ${facts.length}`;
}

async function loadFacts() {
  try {
    const response = await fetch("/facts.json");
    const payload = await response.json();
    facts = payload.facts;
    factIndex = Math.floor(Math.random() * facts.length);
    showFact();
  } catch {
    factText.textContent = "The facts got lost in the abyss. Refresh to send another probe.";
  }
}

function appendMessage(role, text) {
  const message = document.createElement("p");
  message.className = `message ${role}`;
  message.textContent = text;
  chatLog.append(message);
  chatLog.scrollTop = chatLog.scrollHeight;
  return message;
}

async function askSonar(question) {
  const pendingMessage = appendMessage("sonar", "Sonar is pinging the depths...");
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: question, history: conversationHistory }),
    });
    const payload = await response.json();
    if (!response.ok) {
      pendingMessage.className = "message error";
      pendingMessage.textContent = payload.error ?? "Something went wrong down there.";
      return;
    }
    pendingMessage.textContent = payload.reply;
    conversationHistory.push(
      { role: "user", content: question },
      { role: "assistant", content: payload.reply },
    );
    while (conversationHistory.length > 6) {
      conversationHistory.shift();
    }
  } catch {
    pendingMessage.className = "message error";
    pendingMessage.textContent = "Lost contact with the surface. Try again.";
  }
}

nextFactButton.addEventListener("click", () => {
  factIndex = (factIndex + 1) % facts.length;
  showFact();
});

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const question = chatInput.value.trim();
  if (question.length === 0) return;
  appendMessage("user", question);
  chatInput.value = "";
  askSonar(question);
});

window.addEventListener("resize", resizeCanvas);
resizeCanvas();
window.requestAnimationFrame(drawOcean);
loadFacts();
