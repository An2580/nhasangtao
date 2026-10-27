
const MODEL = "@cf/google/gemma-4-26b-a4b-it";
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
  if (!env.AI) {
    return errorResponse(
      "Chưa cấu hình Workers AI binding. Hãy thêm binding tên AI.",
      500
    );
  }

  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return errorResponse("Yêu cầu phải có định dạng JSON.", 415);
  }

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
        return errorResponse("Lịch sử chat không hợp lệ hoặc quá dài.", 400);
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
      return errorResponse("Câu hỏi hoặc lịch sử chat không hợp lệ.", 400);
    }

    // Gộp các tin nhắn liên tiếp cùng vai trò.
    const normalized = [];

    for (const message of messages) {
      const previous = normalized[normalized.length - 1];

      if (previous && previous.role === message.role) {
        previous.content += "\n" + message.content;
      } else {
        normalized.push({ ...message });
      }
    }

    const systemPrompt = {
      role: "system",
      content: "Bạn là trợ lý AI của website An Gờ. Hãy trả lời hữu ích, chính xác, dễ hiểu bằng tiếng Việt khi phù hợp."
    };

    const result = await env.AI.run(MODEL, {
      messages: [systemPrompt, ...normalized],
      max_tokens: 512
    });

    const reply = typeof result?.response === "string"
      ? result.response.trim()
      : typeof result?.choices?.[0]?.message?.content === "string"
        ? result.choices[0].message.content.trim()
        : "";

    if (!reply) {
      console.error("Workers AI returned no text.");
      return errorResponse("AI chưa trả về câu trả lời. Hãy thử lại.", 502);
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
    console.error("Workers AI error:", error.name, error.message);

    return errorResponse(
      "Workers AI đang gặp lỗi hoặc đã đạt giới hạn sử dụng. Hãy thử lại sau.",
      503
    );
  }
}
