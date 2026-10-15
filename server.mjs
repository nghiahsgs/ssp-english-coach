import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 4173);
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const PUBLIC_DIR = fileURLToPath(new URL("./public", import.meta.url));

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const analysisSchema = {
  type: "object",
  properties: {
    overall: { type: "string" },
    strengths: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
    focusAreas: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          why: { type: "string" },
          exampleOriginal: { type: "string" },
          exampleCorrected: { type: "string" },
          rule: { type: "string" },
        },
        required: ["title", "why", "exampleOriginal", "exampleCorrected", "rule"],
      },
    },
    exercise: {
      type: "object",
      properties: {
        vietnamese: { type: "string" },
        target: { type: "string" },
        context: { type: "string" },
      },
      required: ["vietnamese", "target", "context"],
    },
  },
  required: ["overall", "strengths", "focusAreas", "exercise"],
};

const feedbackSchema = {
  type: "object",
  properties: {
    understandable: { type: "boolean" },
    corrected: { type: "string", minLength: 1 },
    natural: { type: "string", minLength: 1 },
    feedback: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
    nextExercise: {
      type: "object",
      properties: {
        vietnamese: { type: "string" },
        target: { type: "string" },
        context: { type: "string" },
      },
      required: ["vietnamese", "target", "context"],
    },
  },
  required: ["understandable", "corrected", "natural", "feedback", "nextExercise"],
};

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_000_000) throw new Error("Nội dung quá lớn. Giới hạn hiện tại là 2 MB.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function ollamaChat({ model, messages, format, think = false }) {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      format,
      stream: false,
      think,
      // Prototype dùng theo lượt: nhả ~4 GB RAM/GPU memory ngay sau mỗi response.
      keep_alive: 0,
      options: { temperature: 0.25 },
    }),
    signal: AbortSignal.timeout(180_000),
  });

  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Ollama không trả lời.");

  try {
    return JSON.parse(result.message.content);
  } catch {
    throw new Error("Model không trả về JSON hợp lệ. Hãy thử lại hoặc chọn model khác.");
  }
}

function normalizeFeedback(result, exercise) {
  if (!result.natural?.trim()) result.natural = result.corrected;
  result.nextExercise.target = exercise.target;

  // Model nhỏ đôi khi gọi nhầm dạng -ing là quá khứ dù câu sửa vẫn đúng.
  result.feedback = result.feedback.map((item) =>
    item.replace(/(['“”][A-Za-z]+ing['“”])\s*\(dạng quá khứ\)/gi, "$1 (dạng -ing)"),
  );
  return result;
}

async function handleApi(req, res) {
  if (req.method === "GET" && req.url === "/api/models") {
    const response = await fetch(`${OLLAMA_URL}/api/tags`);
    const result = await response.json();
    return sendJson(res, response.status, {
      models: (result.models || []).map((item) => item.name),
    });
  }

  if (req.method === "POST" && req.url === "/api/analyze") {
    const { transcript, learnerName = "Andie Nguyen", model } = await readJson(req);
    if (!transcript?.trim() || !model) return sendJson(res, 400, { error: "Thiếu transcript hoặc model." });

    const result = await ollamaChat({
      model,
      format: analysisSchema,
      messages: [
        {
          role: "system",
          content: `You are a precise, practical English conversation coach for a Vietnamese software engineer. Analyze only the learner named ${learnerName}. The transcript is auto-generated and may contain recognition errors, so ignore isolated strange words and never assess pronunciation.

Find 2 or 3 recurring grammar patterns supported by the transcript. Prioritize workplace clarity over academic terminology. Explain in concise Vietnamese. Keep every corrected example close to the learner's intended meaning.

Apply these grammar constraints strictly:
- A finished past-time marker such as "yesterday" requires the past simple, not the present perfect or present perfect continuous.
- Use "did/didn't + base verb", never a past participle after did.
- Use "have/has + past participle" for an unfinished time period or a result connected to now, especially with "yet".
- Do not introduce the present perfect continuous unless duration or an ongoing activity is explicitly intended.
- "It" takes a third-person singular verb in the present simple.
- Do not call an active sentence passive.
- "I testing" is not a valid past-simple form. Correct it to "I tested" when the action is finished.
- The past-simple affirmative structure is subject + past-tense verb. Do not describe it as subject + did + past participle.
- Do not praise an incorrect form as correct.

The exercise must be a Vietnamese sentence based on the meeting context for the learner to translate into English. Its target field must contain a short grammar label such as "past simple" or "present perfect", never the answer.`,
        },
        { role: "user", content: `Analyze this meeting transcript:\n\n${transcript}` },
      ],
    });
    result.exercise.target = result.focusAreas[0]?.title || "Ngữ pháp trong cuộc họp";
    return sendJson(res, 200, result);
  }

  if (req.method === "POST" && req.url === "/api/answer") {
    const { model, exercise, answer, focusAreas = [] } = await readJson(req);
    if (!model || !exercise?.vietnamese || !answer?.trim()) {
      return sendJson(res, 400, { error: "Thiếu bài tập, câu trả lời hoặc model." });
    }

    const result = await ollamaChat({
      model,
      format: feedbackSchema,
      messages: [
        {
          role: "system",
          content: `You are a precise, supportive English coach for a Vietnamese software engineer. First decide whether the answer is understandable. Correct it while preserving the intended meaning. Give a more natural workplace version only when useful. Generate one slightly harder Vietnamese-to-English exercise targeting the same weakness and using a realistic software meeting context.

Every item in the feedback array MUST be written in Vietnamese. Give at most three items. Each feedback item must quote or explicitly reference words that actually appear in learnerAnswer and explain a real difference between learnerAnswer and corrected. Never discuss an error or word that is absent from learnerAnswer.

Apply these constraints strictly:
- A finished past-time marker such as "yesterday" requires the past simple.
- Past-simple affirmative: subject + past-tense verb. Do not claim that it needs "did".
- Call forms such as "tested" in a past-simple affirmative "V2" or "dạng quá khứ", never "past participle" or "quá khứ phân từ".
- Past-simple negative or question: did/didn't + base verb. Never use a past participle after did.
- Present perfect: have/has + past participle. Use it for an unfinished period or a result connected to now, especially with "yet".
- Do not introduce present perfect continuous unless duration or ongoing activity is explicitly intended.
- Address the learner directly as "bạn", not "học sinh" or "người học".
- The next exercise must practice the same target weakness as the current exercise. Copy its target label exactly.
- If the corrected and natural versions are the same, repeat the corrected sentence instead of returning an empty string.
- Keep the natural version close to the original meaning. Do not add a new result or claim.`,
        },
        {
          role: "user",
          content: JSON.stringify({ focusAreas, exercise, learnerAnswer: answer }),
        },
      ],
    });
    return sendJson(res, 200, normalizeFeedback(result, exercise));
  }

  return false;
}

function sendJson(res, status, value) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
  return true;
}

async function serveStatic(req, res) {
  const rawPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const safePath = normalize(rawPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: "Forbidden" });

  try {
    const body = await readFile(filePath);
    res.writeHead(200, { "content-type": mimeTypes[extname(filePath)] || "application/octet-stream" });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: "Không tìm thấy trang." });
  }
}

const server = createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/")) {
      const handled = await handleApi(req, res);
      if (!handled) sendJson(res, 404, { error: "Không tìm thấy API." });
      return;
    }
    await serveStatic(req, res);
  } catch (error) {
    const connectionHint = error.cause?.code === "ECONNREFUSED" ? " Hãy mở Ollama trước." : "";
    sendJson(res, 500, { error: `${error.message}${connectionHint}` });
  }
});

server.listen(PORT, () => {
  console.log(`SSP English prototype: http://localhost:${PORT}`);
  console.log(`Ollama: ${OLLAMA_URL}`);
});
