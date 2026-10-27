
const MODEL = "gemini-3.6-flash";

const TIMEOUT_MS = 45000;
const ATTEMPT_TIMEOUT_MS = 15000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS = [700, 1400];

const MAX_MESSAGES = 20;
const MAX_TEXT_LENGTH = 4000;

const RETRYABLE_STATUSES = new Set([
  429, 500, 502, 503, 504
]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function errorResponse(message, status) {
  return json({
    error: message,
    choices: [{
      message: {
        role: "assistant",
        content: message
      }
    }]
  }, status);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function onRequestPost({ request, env }) {
  const apiKey = env.GEMINI_API_KEY;

  if (!apiKey || !apiKey.trim()) {
    return errorResponse(
      "Máy chủ chưa cấu hình GEMINI_API_KEY.",
      500
    );
  }

  const contentType = request.headers.get("Content-Type") || "";

  if (!contentType.toLowerCase().includes("application/json")) {
    return errorResponse(
      "Yêu cầu phải có định dạng JSON.",
      415
    );
  }

  const origin = request.headers.get("Origin");
  const requestOrigin = new URL(request.url).origin;

  if (origin) {
    try {
      if (new URL(origin).origin !== requestOrigin) {
        return errorResponse(
          "Nguồn yêu cầu không hợp lệ.",
          403
        );
      }
    } catch {
      return errorResponse("Origin không hợp lệ.", 403);
    }
  }

  const startedAt = Date.now();

  try {
    let body;

    try {
      body = await request.json();
    } catch {
      return errorResponse("Dữ liệu JSON không hợp lệ.", 400);
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Dữ liệu yêu cầu không hợp lệ.", 400);
    }

    const source = Array.isArray(body.history)
      ? body.history
      : Array.isArray(body.messages)
        ? body.messages
        : null;

    let contents = [];

    if (source) {
      if (
        source.length === 0 ||
        source.length > MAX_MESSAGES
      ) {
        return errorResponse(
          "Lịch sử chat không hợp lệ hoặc quá dài.",
          400
        );
      }

      contents = source.map(item => {
        if (!item || typeof item !== "object") {
          return null;
        }

        const role = item.role;
        const text = item.text ?? item.content;

        if (
          !["user", "assistant", "model"].includes(role) ||
          typeof text !== "string" ||
          !text.trim() ||
          text.length > MAX_TEXT_LENGTH
        ) {
          return null;
        }

        return {
          role: role === "user" ? "user" : "model",
          parts: [{ text: text.trim() }]
        };
      }).filter(Boolean);
    } else if (
      typeof body.prompt === "string" &&
      body.prompt.trim() &&
      body.prompt.length <= MAX_TEXT_LENGTH
    ) {
      contents = [{
        role: "user",
        parts: [{ text: body.prompt.trim() }]
      }];
    }

    if (!contents.length || contents[0].role !== "user") {
      return errorResponse(
        "Câu hỏi hoặc lịch sử trò chuyện không hợp lệ.",
        400
      );
    }

    // Gộp các lượt liên tiếp có cùng vai trò.
    const normalized = [];

    for (const item of contents) {
      const previous = normalized[normalized.length - 1];

      if (previous && previous.role === item.role) {
        previous.parts[0].text += "\n" + item.parts[0].text;
      } else {
        normalized.push(item);
      }
    }

    const payload = JSON.stringify({
      contents: normalized,
      generationConfig: {
        maxOutputTokens: 512,
        temperature: 0.7
      }
    });

    let result = null;
    let lastStatus = 502;
    let lastError = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const remaining = TIMEOUT_MS - (Date.now() - startedAt);

      if (remaining <= 0) {
        return errorResponse(
          "Gemini phản hồi quá lâu. Hãy thử lại sau.",
          504
        );
      }

      const controller = new AbortController();
      const attemptTimeout = Math.min(
        ATTEMPT_TIMEOUT_MS,
        remaining
      );

      const timer = setTimeout(
        () => controller.abort(),
        attemptTimeout
      );

      let shouldRetry = false;

      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey.trim()
            },
            body: payload,
            signal: controller.signal
          }
        );

        if (response.ok) {
          result = await response.json();
          lastError = null;
          break;
        }

        lastStatus = response.status;

        const details = await response.text();

        console.error(
          "Gemini API error:",
          response.status,
          details.slice(0, 800)
        );

        if (!RETRYABLE_STATUSES.has(response.status)) {
          if (response.status === 400) {
            return errorResponse(
              "Gemini từ chối yêu cầu. Kiểm tra model và nội dung chat.",
              502
            );
          }

          if (response.status === 401 || response.status === 403) {
            return errorResponse(
              "API key hoặc quyền truy cập Gemini không hợp lệ.",
              502
            );
          }

          if (response.status === 404) {
            return errorResponse(
              "Không tìm thấy model Gemini. Kiểm tra tên model.",
              502
            );
          }

          return errorResponse(
            "Gemini trả về lỗi không thể xử lý.",
            502
          );
        }

        lastError = "HTTP " + response.status;
        shouldRetry = true;
      } catch (error) {
        if (error.name === "AbortError") {
          lastError = "timeout";
          lastStatus = 504;
        } else {
          lastError = "network";
          lastStatus = 502;

          console.error(
            "Gemini network error:",
            error.name,
            error.message
          );
        }

        shouldRetry = true;
      } finally {
        clearTimeout(timer);
      }

      if (!shouldRetry) break;

      if (attempt < MAX_ATTEMPTS - 1) {
        const delay = RETRY_DELAYS[attempt];
        const timeLeft = TIMEOUT_MS - (Date.now() - startedAt);

        if (timeLeft <= delay + 100) break;

        console.log(
          `Retrying Gemini request: ${attempt + 2}/${MAX_ATTEMPTS}`
        );

        await wait(delay);
      }
    }

    if (!result) {
      if (lastError === "timeout") {
        return errorResponse(
          "Gemini phản hồi quá lâu sau nhiều lần thử. Hãy thử lại sau.",
          504
        );
      }

      if (lastStatus === 429) {
        return errorResponse(
          "Gemini đang quá tải hoặc đã đạt giới hạn sử dụng. Hãy thử lại sau.",
          429
        );
      }

      if (lastStatus === 503) {
        return errorResponse(
          "Gemini đang quá tải. Hệ thống đã thử lại nhưng chưa thành công. Vui lòng thử lại sau.",
          503
        );
      }

      return errorResponse(
        "Gemini tạm thời không khả dụng. Vui lòng thử lại sau.",
        502
      );
    }

    const reply = result.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();

    if (!reply) {
      console.error(
        "Gemini returned no text:",
        result.promptFeedback?.blockReason || "No text candidate"
      );

      return errorResponse(
        "Gemini chưa trả về câu trả lời. Hãy thử câu hỏi khác.",
        502
      );
    }

    return json({
      choices: [{
        message: {
          role: "assistant",
          content: reply
        }
      }]
    });
  } catch (error) {
    console.error(
      "Chat Function error:",
      error.name,
      error.message
    );

    return errorResponse(
      "Máy chủ không xử lý được yêu cầu chat.",
      500
    );
  }
}
