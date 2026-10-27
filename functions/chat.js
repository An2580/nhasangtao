
const MODEL = "gemini-3.8-flash";
const TIMEOUT_MS = 45000;
const MAX_MESSAGES = 20;
const MAX_TEXT_LENGTH = 4000;

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

export async function onRequestPost({ request, env }) {
  // API key chỉ được lưu trong Cloudflare Secret.
  const apiKey = env.GEMINI_API_KEY;

  if (!apiKey) {
    return errorResponse(
      "Máy chủ chưa cấu hình GEMINI_API_KEY.",
      500
    );
  }

  // Chỉ nhận yêu cầu JSON.
  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return errorResponse("Yêu cầu phải có định dạng JSON.", 415);
  }

  // Chặn các website khác gọi endpoint từ trình duyệt.
  const origin = request.headers.get("Origin");
  const requestOrigin = new URL(request.url).origin;

  if (origin) {
    try {
      if (new URL(origin).origin !== requestOrigin) {
        return errorResponse("Nguồn yêu cầu không hợp lệ.", 403);
      }
    } catch {
      return errorResponse("Origin không hợp lệ.", 403);
    }
  }

  let timer;

  try {
    const body = await request.json();

    // Hỗ trợ nhiều định dạng giao diện chat.
    const source = Array.isArray(body.history)
      ? body.history
      : Array.isArray(body.messages)
        ? body.messages
        : null;

    let contents = [];

    if (source) {
      if (source.length > MAX_MESSAGES) {
        return errorResponse("Lịch sử chat quá dài.", 400);
      }

      contents = source.map(item => {
        if (!item || typeof item !== "object") return null;

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

    // Gemini yêu cầu các lượt hội thoại luân phiên user/model.
    const normalized = [];

    for (const item of contents) {
      const previous = normalized[normalized.length - 1];

      if (previous && previous.role === item.role) {
        previous.parts[0].text += "\n" + item.parts[0].text;
      } else {
        normalized.push(item);
      }
    }

    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const apiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey.trim()
        },
        body: JSON.stringify({
          contents: normalized,
          generationConfig: {
            maxOutputTokens: 512,
            temperature: 0.7
          }
        }),
        signal: controller.signal
      }
    );

    if (!apiResponse.ok) {
      const details = await apiResponse.text();

      // Chỉ ghi mã lỗi và chi tiết đã giới hạn vào log máy chủ.
      console.error(
        "Gemini API error:",
        apiResponse.status,
        details.slice(0, 800)
      );

      if (apiResponse.status === 400) {
        return errorResponse(
          "Gemini từ chối yêu cầu. Kiểm tra model và nội dung chat.",
          502
        );
      }

      if (apiResponse.status === 401 || apiResponse.status === 403) {
        return errorResponse(
          "API key hoặc quyền truy cập Gemini không hợp lệ.",
          502
        );
      }

      if (apiResponse.status === 404) {
        return errorResponse(
          "Không tìm thấy model Gemini. Kiểm tra tên model.",
          502
        );
      }

      if (apiResponse.status === 429) {
        return errorResponse(
          "Gemini đã đạt giới hạn sử dụng. Hãy thử lại sau.",
          429
        );
      }

      return errorResponse(
        "Dịch vụ Gemini tạm thời không khả dụng.",
        502
      );
    }

    const result = await apiResponse.json();

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

    // Giữ định dạng tương thích với frontend đang dùng.
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

    if (error.name === "AbortError") {
      return errorResponse(
        "Gemini phản hồi quá lâu. Hãy thử lại sau.",
        504
      );
    }

    return errorResponse(
      "Máy chủ không xử lý được yêu cầu chat.",
      500
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}
