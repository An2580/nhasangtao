
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

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

function errorResponse(message, status = 500) {
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
  // Xác nhận Workers AI binding đã được cấu hình.
  if (!env.AI || typeof env.AI.run !== "function") {
    console.error("Workers AI binding AI is missing.");

    return errorResponse(
      "Chưa cấu hình Workers AI. Kiểm tra binding có tên AI và triển khai lại.",
      500
    );
  }

  const contentType = request.headers.get("Content-Type") || "";

  if (!contentType.toLowerCase().includes("application/json")) {
    return errorResponse("Yêu cầu phải có định dạng JSON.", 415);
  }

  // Chỉ chấp nhận yêu cầu từ cùng website.
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

    let messages = [];

    if (source) {
      if (!source.length || source.length > MAX_MESSAGES) {
        return errorResponse(
          "Lịch sử chat không hợp lệ hoặc quá dài.",
          400
        );
      }

      messages = source.map(item => {
        if (!item || typeof item !== "object") return null;

        const content = item.text ?? item.content;

        if (
          !["user", "assistant", "model"].includes(item.role) ||
          typeof content !== "string" ||
          !content.trim() ||
          content.length > MAX_TEXT_LENGTH
        ) {
          return null;
        }

        return {
          role: item.role === "user" ? "user" : "assistant",
          content: content.trim()
        };
      }).filter(Boolean);
    } else if (
      typeof body.prompt === "string" &&
      body.prompt.trim() &&
      body.prompt.length <= MAX_TEXT_LENGTH
    ) {
      messages = [{
        role: "user",
        content: body.prompt.trim()
      }];
    }

    if (!messages.length || messages[0].role !== "user") {
      return errorResponse(
        "Câu hỏi hoặc lịch sử trò chuyện không hợp lệ.",
        400
      );
    }

    // Gộp các lượt liên tiếp cùng vai trò.
    const normalized = [];

    for (const message of messages) {
      const previous = normalized[normalized.length - 1];

      if (previous && previous.role === message.role) {
        previous.content += "\n" + message.content;
      } else {
        normalized.push({ ...message });
      }
    }

    const modelMessages = [
      {
        role: "system",
        content:
          "Bạn là trợ lý AI của website An Gờ. " +
          "Hãy trả lời hữu ích, chính xác và dễ hiểu. " +
          "Ưu tiên tiếng Việt khi phù hợp."
      },
      ...normalized
    ];

    let result;

    try {
      result = await env.AI.run(MODEL, {
        messages: modelMessages,
        max_tokens: 512
      });
    } catch (error) {
      console.error(
        "Workers AI diagnostic:",
        error.name,
        error.message
      );

      const detail = String(error.message || "").toLowerCase();

      if (
        detail.includes("limit") ||
        detail.includes("quota") ||
        detail.includes("exceed")
      ) {
        return errorResponse(
          "Workers AI đã đạt giới hạn sử dụng. Hãy thử lại sau.",
          429
        );
      }

      if (
        detail.includes("model") ||
        detail.includes("not found") ||
        detail.includes("not available")
      ) {
        return errorResponse(
          "Model Workers AI không khả dụng. Kiểm tra tên model trong Cloudflare AI Catalog.",
          502
        );
      }

      return errorResponse(
        "Workers AI không xử lý được yêu cầu. Hãy kiểm tra Cloudflare Functions Logs.",
        502
      );
    }

    // Hỗ trợ các dạng phản hồi thường gặp.
    const reply =
      (typeof result?.response === "string" && result.response.trim()) ||
      (
        typeof result?.choices?.[0]?.message?.content === "string" &&
        result.choices[0].message.content.trim()
      ) ||
      "";

    if (!reply) {
      console.error(
        "Workers AI returned an unexpected response:",
        JSON.stringify(result).slice(0, 1000)
      );

      return errorResponse(
        "AI không trả về nội dung. Kiểm tra model và phản hồi trong Cloudflare Logs.",
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
