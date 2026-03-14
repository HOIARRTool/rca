const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 10000;

// ===== Config =====
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL_PRIMARY = process.env.GEMINI_MODEL_PRIMARY || "gemini-2.5-flash";
const GEMINI_MODEL_FALLBACK = process.env.GEMINI_MODEL_FALLBACK || "gemini-3-flash-preview";
const GEMINI_REQUEST_TIMEOUT_MS = Number(process.env.GEMINI_REQUEST_TIMEOUT_MS || 30000);

// ===== Middleware =====
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

// ===== Health check =====
app.get("/healthz", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "RCA Insight Companion",
    primaryModel: GEMINI_MODEL_PRIMARY,
    fallbackModel: GEMINI_MODEL_FALLBACK,
  });
});

// ===== Root =====
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ===== Helpers =====
function buildPayload(userPrompt) {
  return {
    contents: [{ parts: [{ text: userPrompt }] }],
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
    ]
  };
}

function extractText(data) {
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
}

async function callGeminiModel(model, payload, apiKey, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message =
        data?.error?.message ||
        `Gemini API Error (${response.status})`;

      const err = new Error(message);
      err.status = response.status;
      err.model = model;
      err.raw = data;
      throw err;
    }

    const text = extractText(data);
    if (!text) {
      const err = new Error("Model returned empty/blocked content.");
      err.status = 500;
      err.model = model;
      err.raw = data;
      throw err;
    }

    return {
      model,
      data,
      text,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function callGeminiWithFallback(userPrompt) {
  if (!GEMINI_API_KEY) {
    const err = new Error("GEMINI_API_KEY is not configured on server.");
    err.status = 500;
    throw err;
  }

  const payload = buildPayload(userPrompt);
  const modelsToTry = [GEMINI_MODEL_PRIMARY, GEMINI_MODEL_FALLBACK]
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i); // กันชื่อซ้ำ

  let lastError = null;

  for (const model of modelsToTry) {
    try {
      return await callGeminiModel(model, payload, GEMINI_API_KEY, GEMINI_REQUEST_TIMEOUT_MS);
    } catch (error) {
      lastError = error;

      console.error(`[Gemini fail] model=${model}`, {
        status: error.status,
        message: error.message,
      });

      // ถ้า quota/rate limit หรือ timeout ให้ลอง fallback ต่อ
      // ถ้าเป็น error อื่นก็ยังลอง model ถัดไปได้เช่นกัน
    }
  }

  throw lastError || new Error("All Gemini models failed.");
}

// ===== API =====
app.post("/api/generate", async (req, res) => {
  try {
    const userPrompt = req.body?.prompt;

    if (!userPrompt || typeof userPrompt !== "string" || !userPrompt.trim()) {
      return res.status(400).json({
        error: { message: "Prompt is required." }
      });
    }

    const result = await callGeminiWithFallback(userPrompt.trim());

    // ส่งกลับทั้ง text และ model ที่ตอบจริง
    return res.status(200).json({
      ...result.data,
      modelUsed: result.model,
      text: result.text
    });
  } catch (error) {
    console.error("[Server error]", error);

    const status = error.status && Number.isInteger(error.status) ? error.status : 500;

    return res.status(status).json({
      ok: false,
      error: {
        message: error.message || "Internal server error",
        model: error.model || null
      }
    });
  }
});

// ===== Start =====
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on 0.0.0.0:${PORT}`);
});
